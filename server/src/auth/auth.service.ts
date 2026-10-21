import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, UnauthorizedException, ConflictException, BadRequestException, NotFoundException, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { credentialsInput } from '@ccm/shared';
import { z } from 'zod';
import { DatabaseService } from '../database.js';
import { RateLimitService, hashToken, secureCookies } from '../common/security.js';

export interface AuthRequest extends Request { ownerId: string; deviceId?: string }
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

// Web 会话：HttpOnly Cookie + CSRF；密码校验同时供原生设备登录使用。
@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(RateLimitService) private readonly limiter: RateLimitService) {}
  status() { return { initialized: !!this.database.db.prepare('SELECT id FROM users LIMIT 1').get() }; }
  // 用户不存在时也做一次 scrypt，避免以响应时间判断用户名是否存在。
  verifyCredentials(username: string, password: string, limitKey: string) {
    this.limiter.hit(`password:${limitKey}`);
    const row = this.database.db.prepare('SELECT * FROM users WHERE username=?').get(username) as {id: string; username: string; passwordHash: string} | undefined;
    const [salt, stored] = (row?.passwordHash || DUMMY_HASH).split(':');
    const candidate = scryptSync(password, salt, 64);
    if (!row || !timingSafeEqual(candidate, Buffer.from(stored, 'hex'))) throw new UnauthorizedException('用户名或密码错误');
    this.limiter.clear(`password:${limitKey}`);
    return row;
  }
  login(body: unknown, req: Request, res: Response, setup = false) {
    const input = credentialsInput.parse(body);
    if (setup) this.database.db.transaction(() => {
      if (this.status().initialized) throw new ConflictException('实例已经初始化');
      const salt = randomBytes(16).toString('hex');
      const passwordHash = `${salt}:${scryptSync(input.password, salt, 64).toString('hex')}`;
      this.database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(randomUUID(), input.username, passwordHash);
    })();
    const user = this.verifyCredentials(input.username, input.password, req.ip || 'local');
    return this.startSession(user.id, req, res, 'auth.login');
  }
  /** 为已验证身份的用户签发 Web 会话 Cookie；密码登录与 OIDC 登录共用。 */
  startSession(userId: string, req: Request, res: Response, action: string) {
    const now = Date.now();
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    this.database.db.prepare('DELETE FROM sessions WHERE expiresAt<?').run(now);
    this.database.db.prepare('INSERT INTO sessions(tokenHash,userId,csrf,expiresAt,id,createdAt,lastUsedAt,userAgent) VALUES(?,?,?,?,?,?,?,?)').run(hashToken(token), userId, csrf, now + 7 * 86400000, randomUUID(), now, now, (req.headers['user-agent'] || '').slice(0,300));
    res.cookie('ccm_session', token, {httpOnly: true, sameSite: 'strict', secure: secureCookies(), maxAge: 7 * 86400000, path: '/'});
    this.audit(userId, action, userId);
    return { csrf };
  }
  authenticate(req: Request, write = false) {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ccm_session='))?.slice(12);
    const row = raw ? this.database.db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND expiresAt>?').get(hashToken(raw), Date.now()) as {userId: string; csrf: string; id:string} | undefined : undefined;
    if (!row) throw new UnauthorizedException('请先登录');
    if (write && req.headers['x-csrf-token'] !== row.csrf) throw new ForbiddenException('请求校验失败，请刷新后重试');
    this.database.db.prepare('UPDATE sessions SET lastUsedAt=? WHERE id=?').run(Date.now(),row.id);
    return { ownerId: row.userId, csrf: row.csrf, id:row.id };
  }
  audit(owner: string, action: string, entityId: string) {
    this.database.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,action,entityId,'{}',new Date().toISOString());
  }
  sessions(req: Request) {
    const current = this.authenticate(req);
    const rows = this.database.db.prepare('SELECT id,createdAt,lastUsedAt,expiresAt,userAgent FROM sessions WHERE userId=? AND expiresAt>? ORDER BY lastUsedAt DESC,id').all(current.ownerId,Date.now()) as {id:string}[];
    return rows.map(row => ({...row,current:row.id===current.id}));
  }
  revoke(req: Request, id: string) {
    const current = this.authenticate(req,true);
    if (id===current.id) throw new BadRequestException('当前会话请使用退出登录');
    this.database.db.transaction(() => {
      const result=this.database.db.prepare('DELETE FROM sessions WHERE id=? AND userId=?').run(id,current.ownerId);
      if (!result.changes) throw new NotFoundException('会话不存在');
      this.audit(current.ownerId,'auth.session.revoke',id);
    })();
    return {ok:true};
  }
  changePassword(body: unknown, req: Request, res: Response) {
    const input=z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(12).max(128)}).parse(body);
    const current=this.authenticate(req,true);
    if (input.currentPassword===input.newPassword) throw new BadRequestException('新密码不能与当前密码相同');
    const user=this.database.db.prepare('SELECT username FROM users WHERE id=?').get(current.ownerId) as {username:string};
    try { this.verifyCredentials(user.username,input.currentPassword,`change:${current.ownerId}`); }
    catch (error) { this.audit(current.ownerId,'auth.password.rejected',current.ownerId); throw error; }
    const salt=randomBytes(16).toString('hex');
    const passwordHash=`${salt}:${scryptSync(input.newPassword,salt,64).toString('hex')}`;
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    this.database.db.transaction(() => {
      this.database.db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(passwordHash,current.ownerId);
      this.database.db.prepare('DELETE FROM sessions WHERE userId=? AND id<>?').run(current.ownerId,current.id);
      this.database.db.prepare('UPDATE sessions SET tokenHash=?,csrf=?,expiresAt=? WHERE id=?').run(hashToken(token),csrf,Date.now()+7*86400000,current.id);
      this.database.db.prepare('UPDATE device_sessions SET revokedAt=?,revokedReason=? WHERE userId=? AND revokedAt IS NULL').run(new Date().toISOString(),'password_changed',current.ownerId);
      this.database.db.prepare('DELETE FROM pairing_codes WHERE userId=?').run(current.ownerId);
      this.audit(current.ownerId,'auth.password.change',current.ownerId);
    })();
    res.cookie('ccm_session',token,{httpOnly:true,sameSite:'strict',secure:secureCookies(),maxAge:7*86400000,path:'/'});
    return {csrf};
  }
  logout(req: Request, res: Response) {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ccm_session='))?.slice(12);
    if (raw) this.database.db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hashToken(raw));
    res.clearCookie('ccm_session', {path: '/'});
    return {ok: true};
  }
}
