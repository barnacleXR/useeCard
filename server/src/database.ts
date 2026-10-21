import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class DatabaseService {
  readonly db: Database.Database;
  constructor(path = process.env.DATABASE_PATH || '.data/ccm.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, defaultCurrency TEXT NOT NULL DEFAULT 'JPY');
      CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bank_accounts(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, bankName TEXT NOT NULL, note TEXT NOT NULL, archivedAt TEXT);
      CREATE TABLE IF NOT EXISTS credit_cards(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, issuer TEXT NOT NULL, last4 TEXT NOT NULL, defaultDebitAccountId TEXT NOT NULL REFERENCES bank_accounts(id), defaultCurrency TEXT NOT NULL, frequency TEXT NOT NULL CHECK(frequency IN ('regular','low')), archivedAt TEXT);
      CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), cardId TEXT NOT NULL REFERENCES credit_cards(id), debitAccountId TEXT NOT NULL REFERENCES bank_accounts(id), amountMinor INTEGER NOT NULL CHECK(amountMinor>0 AND amountMinor<=9007199254740991), currency TEXT NOT NULL, dueDate TEXT NOT NULL, statementMonth TEXT, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','void')), version INTEGER NOT NULL DEFAULT 1, paidAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bills_owner_due ON bills(ownerId,dueDate,status,currency);
      CREATE TABLE IF NOT EXISTS review_periods(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), reviewMonth TEXT NOT NULL, UNIQUE(ownerId,reviewMonth));
      CREATE TABLE IF NOT EXISTS card_reviews(id TEXT PRIMARY KEY, periodId TEXT NOT NULL REFERENCES review_periods(id), cardId TEXT NOT NULL REFERENCES credit_cards(id), status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','no_new','reviewed')), version INTEGER NOT NULL DEFAULT 1, confirmedAt TEXT, UNIQUE(periodId,cardId));
      CREATE TABLE IF NOT EXISTS review_bill_links(reviewId TEXT NOT NULL REFERENCES card_reviews(id), billId TEXT NOT NULL REFERENCES bills(id), PRIMARY KEY(reviewId,billId));
      CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, action TEXT NOT NULL, entityId TEXT NOT NULL, changes TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(ownerId TEXT NOT NULL, requestKey TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(ownerId,requestKey));
      INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
    `);
    // v2：卡片备注，账户/卡片乐观锁版本。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE credit_cards ADD COLUMN note TEXT NOT NULL DEFAULT '';
        ALTER TABLE credit_cards ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE bank_accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        INSERT INTO schema_migrations(version) VALUES(2);
      `);
    })();
    // v3：账户/卡片显示顺序，沿用原创建顺序。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE bank_accounts ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE credit_cards ADD COLUMN sortOrder INTEGER NOT NULL DEFAULT 0;
        UPDATE bank_accounts SET sortOrder=rowid;
        UPDATE credit_cards SET sortOrder=rowid;
        CREATE INDEX IF NOT EXISTS bills_owner_card ON bills(ownerId,cardId,dueDate);
        INSERT INTO schema_migrations(version) VALUES(3);
      `);
    })();
    // v4：实例标识、原生设备会话、一次性配对码、提醒偏好。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get()) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE instance_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE device_sessions(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, platform TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('password','pairing')),
          accessHash TEXT NOT NULL UNIQUE, accessExpiresAt INTEGER NOT NULL, refreshHash TEXT NOT NULL UNIQUE, previousRefreshHash TEXT, refreshExpiresAt INTEGER NOT NULL,
          createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT, revokedReason TEXT);
        CREATE INDEX device_sessions_user ON device_sessions(userId);
        CREATE INDEX device_sessions_previous ON device_sessions(previousRefreshHash);
        CREATE TABLE pairing_codes(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), codeHash TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL, createdAt TEXT NOT NULL, consumedAt TEXT, deviceSessionId TEXT);
        ALTER TABLE users ADD COLUMN reminderDaysBefore INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN reminderTime TEXT NOT NULL DEFAULT '09:00';
        INSERT INTO schema_migrations(version) VALUES(4);
      `);
    })();
    // v5：图片资产（存于库内，随数据库一并备份）、账户银行代码与图标、卡片卡组织与图标。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()) this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE assets(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL,
          source TEXT NOT NULL CHECK(source IN ('upload','url','site')), sourceUrl TEXT, createdAt TEXT NOT NULL, UNIQUE(ownerId,sha256));
        ALTER TABLE bank_accounts ADD COLUMN bankCode TEXT NOT NULL DEFAULT '';
        ALTER TABLE bank_accounts ADD COLUMN iconAssetId TEXT REFERENCES assets(id);
        ALTER TABLE credit_cards ADD COLUMN brand TEXT NOT NULL DEFAULT '';
        ALTER TABLE credit_cards ADD COLUMN iconAssetId TEXT REFERENCES assets(id);
        INSERT INTO schema_migrations(version) VALUES(5);
      `);
    })();
    // v6：浏览器会话使用独立公开标识，令牌摘要不对外暴露。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=6').get()) this.db.transaction(() => {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN id TEXT;
        ALTER TABLE sessions ADD COLUMN createdAt INTEGER;
        ALTER TABLE sessions ADD COLUMN lastUsedAt INTEGER;
        ALTER TABLE sessions ADD COLUMN userAgent TEXT NOT NULL DEFAULT '';
        CREATE UNIQUE INDEX sessions_public_id ON sessions(id);
        CREATE INDEX audit_owner_date ON audit_events(ownerId,createdAt,id);
        INSERT INTO schema_migrations(version) VALUES(6);`);
      const rows = this.db.prepare('SELECT tokenHash,expiresAt FROM sessions').all() as {tokenHash:string;expiresAt:number}[];
      for (const row of rows) this.db.prepare('UPDATE sessions SET id=?,createdAt=?,lastUsedAt=? WHERE tokenHash=?').run(randomUUID(),row.expiresAt-7*86400000,row.expiresAt-7*86400000,row.tokenHash);
    })();
    // v7：站内通知快照、已读状态与历史记录。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=7').get()) this.db.transaction(() => {
      this.db.exec(`ALTER TABLE users ADD COLUMN inAppNotifications INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE notifications(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), notificationKey TEXT NOT NULL, kind TEXT NOT NULL,
          payload TEXT NOT NULL, fingerprint TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, readAt TEXT, resolvedAt TEXT, UNIQUE(ownerId,notificationKey));
        CREATE INDEX notifications_owner_updated ON notifications(ownerId,updatedAt,id);
        INSERT INTO schema_migrations(version) VALUES(7);`);
    })();
    // v8：Apprise 通道与可重试投递记录，目标地址仅在服务端读取。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=8').get()) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE notification_channels(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, service TEXT NOT NULL, url TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, archivedAt TEXT);
        CREATE INDEX notification_channels_owner ON notification_channels(ownerId);
        CREATE TABLE notification_deliveries(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), channelId TEXT NOT NULL REFERENCES notification_channels(id),
          notificationId TEXT REFERENCES notifications(id), notificationVersion INTEGER, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt TEXT, lastError TEXT,
          createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, UNIQUE(channelId,notificationId,notificationVersion));
        CREATE INDEX notification_deliveries_due ON notification_deliveries(status,nextAttemptAt);
        INSERT INTO schema_migrations(version) VALUES(8);`);
    })();
    // v9：只读 REST API v1 的独立 API Key（只存哈希，原文仅创建时显示一次）。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=9').get()) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE api_keys(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, prefix TEXT NOT NULL, keyHash TEXT NOT NULL UNIQUE,
          scopes TEXT NOT NULL, expiresAt TEXT, createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT);
        CREATE INDEX api_keys_user ON api_keys(userId);
        INSERT INTO schema_migrations(version) VALUES(9);`);
    })();
    // v10：MCP 的 OAuth 授权服务器——客户端、一次性授权码、授权会话（访问/刷新令牌族）。凭证均只存哈希。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=10').get()) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE oauth_clients(id TEXT PRIMARY KEY, name TEXT NOT NULL, redirectUris TEXT NOT NULL, secretHash TEXT, source TEXT NOT NULL CHECK(source IN ('dcr','manual')),
          createdBy TEXT REFERENCES users(id), createdAt TEXT NOT NULL, revokedAt TEXT);
        CREATE TABLE oauth_codes(codeHash TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES oauth_clients(id), userId TEXT NOT NULL REFERENCES users(id), scopes TEXT NOT NULL,
          codeChallenge TEXT NOT NULL, redirectUri TEXT NOT NULL, expiresAt INTEGER NOT NULL, consumedAt TEXT, createdAt TEXT NOT NULL);
        CREATE TABLE oauth_grants(id TEXT PRIMARY KEY, clientId TEXT NOT NULL REFERENCES oauth_clients(id), userId TEXT NOT NULL REFERENCES users(id), scopes TEXT NOT NULL,
          accessHash TEXT NOT NULL UNIQUE, accessExpiresAt INTEGER NOT NULL, refreshHash TEXT NOT NULL UNIQUE, previousRefreshHash TEXT, refreshExpiresAt INTEGER NOT NULL,
          codeHash TEXT, createdAt TEXT NOT NULL, lastUsedAt TEXT, revokedAt TEXT, revokedReason TEXT);
        CREATE INDEX oauth_grants_user ON oauth_grants(userId);
        CREATE INDEX oauth_grants_previous ON oauth_grants(previousRefreshHash);
        INSERT INTO schema_migrations(version) VALUES(10);`);
    })();
    // v11：绑定到本地账号的外部 OIDC 身份（每个账号最多一个，issuer+subject 唯一）。
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=11').get()) this.db.transaction(() => {
      this.db.exec(`CREATE TABLE oidc_identities(id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES users(id), issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT,
          linkedAt TEXT NOT NULL, lastLoginAt TEXT, UNIQUE(issuer,subject));
        INSERT INTO schema_migrations(version) VALUES(11);`);
    })();
    this.db.prepare('INSERT OR IGNORE INTO instance_settings VALUES(?,?)').run('instanceId', randomUUID());
  }
  close() { this.db.close(); }
}
