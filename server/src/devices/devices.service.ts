import { randomInt, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { deviceLoginInput, pairInput, refreshInput, type DeviceSession, type DeviceTokens, type PairingCode, type ServerInfo } from '@ccm/shared';
import { AuthService } from '../auth/auth.service.js';
import { LedgerService } from '../common/ledger.service.js';
import { RateLimitService, hashToken, randomToken } from '../common/security.js';

export const ACCESS_TTL = 3600_000;
export const REFRESH_TTL = 60 * 86400_000;
export const PAIRING_TTL = 10 * 60_000;
// 去掉易混淆字符（0/O、1/I/L）。
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
interface SessionRow { id: string; userId: string; name: string; accessExpiresAt: number; refreshExpiresAt: number; revokedAt: string | null }

// 原生 App 设备会话：audience 只有 /api/app/v1，与 Web Cookie、MCP、REST API Key 分离。
@Injectable()
export class DevicesService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService, @Inject(AuthService) private readonly auth: AuthService, @Inject(RateLimitService) private readonly limiter: RateLimitService) {}
  private get db() { return this.ledger.db; }
  instanceId() { return (this.db.prepare("SELECT value FROM instance_settings WHERE key='instanceId'").get() as {value: string}).value; }
  serverInfo(): ServerInfo { return {service: 'useecard', instanceId: this.instanceId(), name: 'useeCard', appApiVersion: 1, authMethods: ['password', 'pairing']}; }

  private issue(userId: string, name: string, platform: string, method: 'password' | 'pairing'): DeviceTokens {
    const id = randomUUID(); const now = Date.now(); const access = randomToken('ccma'); const refresh = randomToken('ccmr');
    this.db.prepare('INSERT INTO device_sessions(id,userId,name,platform,method,accessHash,accessExpiresAt,refreshHash,refreshExpiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, name, platform, method, hashToken(access), now + ACCESS_TTL, hashToken(refresh), now + REFRESH_TTL, new Date(now).toISOString());
    this.ledger.audit(userId, 'device.create', id, {name, platform, method});
    return this.tokens(userId, id, name, access, refresh, now);
  }
  private tokens(userId: string, id: string, name: string, access: string, refresh: string, now: number): DeviceTokens {
    const user = this.db.prepare('SELECT id,username FROM users WHERE id=?').get(userId) as {id: string; username: string};
    return {tokenType: 'Bearer', accessToken: access, accessExpiresAt: new Date(now + ACCESS_TTL).toISOString(), refreshToken: refresh, refreshExpiresAt: new Date(now + REFRESH_TTL).toISOString(), instanceId: this.instanceId(), user, device: {id, name}};
  }

  // 账号密码只用于换取设备令牌，App 不长期保存密码。
  login(body: unknown, ip: string) {
    const input = deviceLoginInput.parse(body);
    const user = this.auth.verifyCredentials(input.username, input.password, ip);
    return this.db.transaction(() => this.issue(user.id, input.deviceName, input.platform, 'password'))();
  }

  // Web 已登录用户生成；同一用户仅保留最新一个未使用的配对码。
  createPairingCode(owner: string): PairingCode {
    const code = Array.from({length: 8}, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join('');
    const expiresAt = Date.now() + PAIRING_TTL;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM pairing_codes WHERE userId=? AND consumedAt IS NULL').run(owner);
      this.db.prepare('INSERT INTO pairing_codes(id,userId,codeHash,expiresAt,createdAt) VALUES(?,?,?,?,?)').run(randomUUID(), owner, hashToken(code), expiresAt, new Date().toISOString());
      this.ledger.audit(owner, 'device.pairing-code', owner, {expiresAt});
    })();
    return {code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(expiresAt).toISOString()};
  }
  // 原子消费：条件更新只有一个请求能成功；错误码按来源 IP 计入失败次数。
  pair(body: unknown, ip: string) {
    const input = pairInput.parse(body);
    this.limiter.hit(`pair:${ip}`, 5);
    const result = this.db.transaction(() => {
      const row = this.db.prepare('SELECT id,userId FROM pairing_codes WHERE codeHash=? AND consumedAt IS NULL AND expiresAt>?').get(hashToken(normalizeCode(input.code)), Date.now()) as {id: string; userId: string} | undefined;
      if (!row) return undefined;
      const consumed = this.db.prepare('UPDATE pairing_codes SET consumedAt=? WHERE id=? AND consumedAt IS NULL').run(new Date().toISOString(), row.id);
      if (!consumed.changes) return undefined;
      const tokens = this.issue(row.userId, input.deviceName, input.platform, 'pairing');
      this.db.prepare('UPDATE pairing_codes SET deviceSessionId=? WHERE id=?').run(tokens.device.id, row.id);
      return tokens;
    })();
    if (!result) throw new UnauthorizedException('配对码无效、已使用或已过期');
    this.limiter.clear(`pair:${ip}`);
    return result;
  }

  // 刷新令牌每次轮换；出示已被轮换掉的旧令牌视为泄露，吊销整个设备会话。
  refresh(body: unknown) {
    const {refreshToken} = refreshInput.parse(body);
    const presented = hashToken(refreshToken); const now = Date.now();
    // 吊销在事务内提交，再在事务外抛错，避免回滚掉吊销。
    const result = this.db.transaction(() => {
      const reused = this.db.prepare('SELECT id,userId FROM device_sessions WHERE previousRefreshHash=? AND revokedAt IS NULL').get(presented) as {id: string; userId: string} | undefined;
      if (reused) { this.revokeRow(reused.userId, reused.id, 'refresh-reuse'); return undefined; }
      const row = this.db.prepare('SELECT * FROM device_sessions WHERE refreshHash=?').get(presented) as SessionRow | undefined;
      if (!row || row.revokedAt || row.refreshExpiresAt <= now) return undefined;
      const access = randomToken('ccma'); const refresh = randomToken('ccmr');
      this.db.prepare('UPDATE device_sessions SET accessHash=?,accessExpiresAt=?,refreshHash=?,previousRefreshHash=?,refreshExpiresAt=?,lastUsedAt=? WHERE id=?')
        .run(hashToken(access), now + ACCESS_TTL, hashToken(refresh), presented, now + REFRESH_TTL, new Date(now).toISOString(), row.id);
      return this.tokens(row.userId, row.id, row.name, access, refresh, now);
    })();
    if (!result) throw new UnauthorizedException('设备登录已失效，请重新登录或配对');
    return result;
  }

  authenticate(header: string | undefined) {
    const token = header?.match(/^Bearer\s+(ccma_[A-Za-z0-9_-]+)$/)?.[1];
    const row = token ? this.db.prepare('SELECT id,userId,accessExpiresAt,revokedAt FROM device_sessions WHERE accessHash=?').get(hashToken(token)) as SessionRow | undefined : undefined;
    if (!row || row.revokedAt || row.accessExpiresAt <= Date.now()) throw new UnauthorizedException('设备令牌无效或已过期');
    this.db.prepare('UPDATE device_sessions SET lastUsedAt=? WHERE id=?').run(new Date().toISOString(), row.id);
    return {ownerId: row.userId, deviceId: row.id};
  }

  list(owner: string, currentId?: string): DeviceSession[] {
    const rows = this.db.prepare('SELECT id,name,platform,method,createdAt,lastUsedAt FROM device_sessions WHERE userId=? AND revokedAt IS NULL AND refreshExpiresAt>? ORDER BY createdAt DESC').all(owner, Date.now()) as DeviceSession[];
    return rows.map(row => ({...row, ...(currentId ? {current: row.id === currentId} : {})}));
  }
  private revokeRow(owner: string, id: string, reason: string) {
    this.db.prepare('UPDATE device_sessions SET revokedAt=?,revokedReason=? WHERE id=? AND userId=? AND revokedAt IS NULL').run(new Date().toISOString(), reason, id, owner);
    this.ledger.audit(owner, 'device.revoke', id, {reason});
  }
  revoke(owner: string, id: string, reason = 'user') {
    if (!this.db.prepare('SELECT 1 FROM device_sessions WHERE id=? AND userId=? AND revokedAt IS NULL').get(id, owner)) throw new NotFoundException('设备不存在或已撤销');
    this.db.transaction(() => this.revokeRow(owner, id, reason))();
    return {ok: true};
  }
}
