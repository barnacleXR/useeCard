import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { apiKeyCreateInput, type ApiKeyCreated, type ApiKeyInfo, type ApiScope } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { hashToken, randomToken } from '../common/security.js';

interface KeyRow { id: string; userId: string; name: string; prefix: string; scopes: string; expiresAt: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
export interface ApiKeySession { ownerId: string; keyId: string; scopes: ApiScope[] }

// 只读 REST API v1 的独立凭证：与 Web Cookie、原生设备令牌、MCP 令牌互不通用。
@Injectable()
export class ApiKeysService {
  /** 每个 Key 每分钟请求上限；测试或部署可通过 CCM_API_RATE_LIMIT 调整。 */
  private readonly limit = Number(process.env.CCM_API_RATE_LIMIT) || 120;
  private readonly windowMs = 60_000;
  private readonly windows = new Map<string, {start: number; count: number}>();
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}
  private get db() { return this.ledger.db; }

  private info(row: KeyRow): ApiKeyInfo {
    return {id: row.id, name: row.name, prefix: row.prefix, scopes: JSON.parse(row.scopes), expiresAt: row.expiresAt, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt};
  }

  list(owner: string): ApiKeyInfo[] {
    return (this.db.prepare('SELECT * FROM api_keys WHERE userId=? AND revokedAt IS NULL ORDER BY createdAt DESC').all(owner) as KeyRow[]).map(row => this.info(row));
  }

  /** 原文只在此处返回一次；服务端只保存哈希与可辨认的前缀。 */
  create(owner: string, body: unknown): ApiKeyCreated {
    const input = apiKeyCreateInput.parse(body);
    const key = randomToken('ccmk'); const id = randomUUID(); const now = new Date();
    const expiresAt = input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * 86400_000).toISOString() : null;
    const row: KeyRow = {id, userId: owner, name: input.name, prefix: key.slice(0, 12), scopes: JSON.stringify(input.scopes), expiresAt, createdAt: now.toISOString(), lastUsedAt: null, revokedAt: null};
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO api_keys(id,userId,name,prefix,keyHash,scopes,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, row.name, row.prefix, hashToken(key), row.scopes, expiresAt, row.createdAt);
      this.ledger.audit(owner, 'api-key.create', id, {name: row.name, scopes: input.scopes, expiresAt});
    })();
    return {...this.info(row), key};
  }

  revoke(owner: string, id: string) {
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE api_keys SET revokedAt=? WHERE id=? AND userId=? AND revokedAt IS NULL').run(new Date().toISOString(), id, owner);
      if (!result.changes) throw new NotFoundException('API Key 不存在或已撤销');
      this.ledger.audit(owner, 'api-key.revoke', id, {});
    })();
    return {ok: true};
  }

  authenticate(header: string | undefined): ApiKeySession {
    const key = header?.match(/^Bearer\s+(ccmk_[A-Za-z0-9_-]+)$/)?.[1];
    const row = key ? this.db.prepare('SELECT * FROM api_keys WHERE keyHash=?').get(hashToken(key)) as KeyRow | undefined : undefined;
    if (!row || row.revokedAt) throw new UnauthorizedException('API Key 无效或已撤销');
    if (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) throw new UnauthorizedException('API Key 已过期');
    // 最后使用时间精确到分钟即可，避免每个请求都写库。
    if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > 60_000) this.db.prepare('UPDATE api_keys SET lastUsedAt=? WHERE id=?').run(new Date().toISOString(), row.id);
    return {ownerId: row.userId, keyId: row.id, scopes: JSON.parse(row.scopes)};
  }

  /** 按 Key 的固定窗口限流；超限时返回需等待的秒数，否则返回 0。 */
  hit(keyId: string): number {
    const now = Date.now(); const window = this.windows.get(keyId);
    if (!window || now - window.start >= this.windowMs) { this.windows.set(keyId, {start: now, count: 1}); return 0; }
    if (window.count >= this.limit) return Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000));
    window.count++;
    return 0;
  }
}
