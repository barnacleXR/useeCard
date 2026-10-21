import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { OidcIdentityInfo, OidcStatus } from '@ccm/shared';
import { AuthService } from '../auth/auth.service.js';
import { DatabaseService } from '../database.js';
import { RateLimitService, secureCookies } from '../common/security.js';
import { allowsPlainHttp, readOidcConfig, type OidcConfig } from './oidc.config.js';

const STATE_COOKIE = 'ccm_oidc_state';
const COOKIE_PATH = '/api/auth/oidc';
const FLOW_TTL_MS = 5 * 60_000;
const MAX_FLOWS = 1000;
const META_TTL_MS = 3600_000;
const HTTP_TIMEOUT_MS = 5000;
const MAX_DOC_BYTES = 256 * 1024;
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

/** 失败代码只通过 URL 片段（#）返回浏览器，不进入服务器访问日志。 */
export type OidcFailure = 'misconfigured' | 'provider-unreachable' | 'state-invalid' | 'provider-refused' | 'token-invalid' | 'not-linked' | 'identity-in-use' | 'session-ended' | 'rate-limited';
class OidcError extends Error { constructor(readonly code: OidcFailure, message: string) { super(message); } }

interface Flow { nonce: string; verifier: string; mode: 'login' | 'link'; userId?: string; sessionId?: string; expiresAt: number }
interface Discovery { authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
interface IdentityRow { id: string; userId: string; issuer: string; subject: string; email: string | null; linkedAt: string; lastLoginAt: string | null }

async function readBounded(response: globalThis.Response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_DOC_BYTES) return null;
  const text = await response.text();
  return Buffer.byteLength(text) > MAX_DOC_BYTES ? null : text;
}

/**
 * 通过外部 OIDC 提供方登录（授权码 + PKCE + nonce）。外部身份必须先在设置页绑定到已登录的本地账号，
 * 未绑定的身份不会创建账号。state 同时存于服务端（一次性）和浏览器的短期 Cookie 中，两者一致才继续。
 */
@Injectable()
export class OidcService {
  private readonly flows = new Map<string, Flow>();
  private discovery?: {issuer: string; doc: Discovery; fetchedAt: number};
  private keys?: {jwksUri: string; get: JWTVerifyGetKey};

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AuthService) private readonly auth: AuthService,
              @Inject(RateLimitService) private readonly limiter: RateLimitService) {}
  private get db() { return this.database.db; }

  /** 公开状态：仅在配置有效且已有账号绑定身份时展示登录按钮。 */
  publicStatus(): OidcStatus | undefined {
    const result = readOidcConfig();
    if (!result.on || !this.db.prepare('SELECT 1 FROM oidc_identities LIMIT 1').get()) return undefined;
    return {name: result.config.name};
  }

  identity(owner: string): OidcIdentityInfo {
    const result = readOidcConfig();
    const row = this.db.prepare('SELECT * FROM oidc_identities WHERE userId=?').get(owner) as IdentityRow | undefined;
    return {configured: result.on, name: result.on ? result.config.name : null, configError: result.on ? null : result.error ?? null,
      redirectUri: result.on ? result.config.redirectUri : null,
      identity: row ? {issuer: row.issuer, email: row.email, linkedAt: row.linkedAt, lastLoginAt: row.lastLoginAt} : null};
  }

  unlink(owner: string) {
    this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM oidc_identities WHERE userId=?').run(owner);
      if (!result.changes) throw new NotFoundException('当前账号没有绑定 OIDC 身份');
      this.auth.audit(owner, 'auth.oidc.unlink', owner);
    })();
    return {ok: true};
  }

  // ---------- 发起 ----------

  /** 登录：浏览器直接访问，跳转到提供方。 */
  async startLogin(req: Request, res: Response) {
    try {
      this.limiter.hit(`oidc:${req.ip || 'local'}`, 30);
      res.redirect(302, await this.begin(res, {mode: 'login'}));
    } catch (error) { this.fail(res, 'login', error); }
  }

  /** 绑定：已登录用户经 CSRF 校验后发起，返回提供方地址由前端跳转。 */
  async startLink(owner: string, sessionId: string, res: Response) {
    try { return {url: await this.begin(res, {mode: 'link', userId: owner, sessionId})}; }
    catch (error) { if (error instanceof OidcError) return {url: `/settings#oidc-link=${error.code}`}; throw error; }
  }

  private async begin(res: Response, flow: Pick<Flow, 'mode' | 'userId' | 'sessionId'>) {
    const config = this.config();
    const doc = await this.metadata(config);
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    this.prune();
    if (this.flows.size >= MAX_FLOWS) this.flows.delete(this.flows.keys().next().value!);
    this.flows.set(state, {...flow, nonce, verifier, expiresAt: Date.now() + FLOW_TTL_MS});
    // 回调是来自提供方的跨站跳转，SameSite=Strict 的 Cookie 不会携带，因此 state Cookie 使用 Lax。
    res.cookie(STATE_COOKIE, state, {httpOnly: true, sameSite: 'lax', secure: secureCookies(), maxAge: FLOW_TTL_MS, path: COOKIE_PATH});
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  }

  // ---------- 回调 ----------

  async callback(req: Request, res: Response) {
    const state = String(req.query.state ?? '');
    const cookies = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${STATE_COOKIE}=`)).map(s => s.slice(STATE_COOKIE.length + 1));
    res.clearCookie(STATE_COOKIE, {path: COOKIE_PATH});
    this.prune();
    // state 必须与本浏览器发起时的 Cookie 一致，且服务端记录只能使用一次。
    const flow = state && cookies.length === 1 && cookies[0] === state ? this.flows.get(state) : undefined;
    if (flow) this.flows.delete(state);
    const mode = flow?.mode ?? 'login';
    try {
      if (!flow) throw new OidcError('state-invalid', 'state 与本浏览器发起的登录不匹配或已过期');
      if (req.query.error) throw new OidcError('provider-refused', `提供方拒绝授权：${String(req.query.error).slice(0, 80)}`);
      const code = String(req.query.code ?? '');
      if (!code) throw new OidcError('token-invalid', '回调缺少 code');
      const config = this.config();
      const {subject, email} = await this.verify(config, await this.exchange(config, code, flow.verifier), flow.nonce);
      const existing = this.db.prepare('SELECT * FROM oidc_identities WHERE issuer=? AND subject=?').get(config.issuer, subject) as IdentityRow | undefined;

      if (flow.mode === 'link') {
        if (!this.db.prepare('SELECT 1 FROM sessions WHERE id=? AND userId=? AND expiresAt>?').get(flow.sessionId, flow.userId, Date.now())) throw new OidcError('session-ended', '发起绑定的登录已失效');
        if (existing && existing.userId !== flow.userId) throw new OidcError('identity-in-use', '该身份已绑定到其他账号');
        this.db.transaction(() => {
          this.db.prepare('DELETE FROM oidc_identities WHERE userId=?').run(flow.userId);
          this.db.prepare('INSERT INTO oidc_identities(id,userId,issuer,subject,email,linkedAt) VALUES(?,?,?,?,?,?)').run(randomUUID(), flow.userId, config.issuer, subject, email, new Date().toISOString());
          this.auth.audit(flow.userId!, 'auth.oidc.link', flow.userId!);
        })();
        res.redirect(302, '/settings#oidc-link=ok');
        return;
      }

      if (!existing) throw new OidcError('not-linked', '该身份尚未绑定到 useeCard 账号');
      this.db.prepare('UPDATE oidc_identities SET lastLoginAt=?,email=COALESCE(?,email) WHERE id=?').run(new Date().toISOString(), email, existing.id);
      this.auth.startSession(existing.userId, req, res, 'auth.login.oidc');
      res.redirect(302, '/');
    } catch (error) { this.fail(res, mode, error); }
  }

  private fail(res: Response, mode: Flow['mode'], error: unknown) {
    const code: OidcFailure = error instanceof OidcError ? error.code : (error as {status?: number})?.status === 429 ? 'rate-limited' : 'provider-unreachable';
    console.warn(`OIDC ${mode === 'link' ? '绑定' : '登录'}失败（${code}）：${(error as Error)?.message}`);
    res.redirect(302, mode === 'link' ? `/settings#oidc-link=${code}` : `/#oidc-error=${code}`);
  }

  private config(): OidcConfig {
    const result = readOidcConfig();
    if (!result.on) throw new OidcError('misconfigured', result.error ?? '未配置 OIDC');
    return result.config;
  }

  private prune() { const now = Date.now(); for (const [key, flow] of this.flows) if (flow.expiresAt < now) this.flows.delete(key); }

  // ---------- 提供方 ----------

  private async fetchJson(url: string, init: RequestInit = {}) {
    let response: globalThis.Response;
    try { response = await fetch(url, {...init, redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), headers: {accept: 'application/json', ...init.headers}}); }
    catch { throw new OidcError('provider-unreachable', `无法连接 ${url}`); }
    const text = await readBounded(response).catch(() => null);
    let body: unknown;
    try { body = text === null ? undefined : JSON.parse(text); } catch { body = undefined; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OidcError('provider-unreachable', `${url} 返回 ${response.status}，不是 JSON 对象`);
    return {status: response.status, body: body as Record<string, unknown>};
  }

  private async metadata(config: OidcConfig): Promise<Discovery> {
    if (this.discovery && this.discovery.issuer === config.issuer && Date.now() - this.discovery.fetchedAt < META_TTL_MS) return this.discovery.doc;
    const url = `${config.issuer}/.well-known/openid-configuration`;
    const {status, body} = await this.fetchJson(url);
    if (status !== 200) throw new OidcError('provider-unreachable', `${url} 返回 ${status}`);
    if (body.issuer !== config.issuer) throw new OidcError('misconfigured', `OIDC_ISSUER 为 ${config.issuer}，但提供方自称 ${String(body.issuer)}，两者必须完全一致`);
    const localIssuer = new URL(config.issuer).protocol === 'http:';
    for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      let endpoint: URL;
      try { endpoint = new URL(String(body[field])); } catch { throw new OidcError('misconfigured', `发现文档缺少有效的 ${field}`); }
      if (endpoint.protocol !== 'https:' && !(localIssuer && endpoint.protocol === 'http:' && allowsPlainHttp(endpoint))) throw new OidcError('misconfigured', `${field} 必须是 https 地址`);
    }
    const doc = body as unknown as Discovery;
    this.discovery = {issuer: config.issuer, doc, fetchedAt: Date.now()};
    return doc;
  }

  private async exchange(config: OidcConfig, code: string, verifier: string) {
    const doc = await this.metadata(config);
    const form = new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, client_id: config.clientId, code_verifier: verifier});
    if (config.clientSecret) form.set('client_secret', config.clientSecret);
    const {status, body} = await this.fetchJson(doc.token_endpoint, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: form.toString()});
    if (status !== 200) throw new OidcError(typeof body.error === 'string' ? 'token-invalid' : 'provider-unreachable', `令牌端点返回 ${status} ${typeof body.error === 'string' ? body.error : ''}`);
    if (typeof body.id_token !== 'string' || !body.id_token) throw new OidcError('token-invalid', '令牌端点没有返回 id_token');
    return body.id_token;
  }

  private async verify(config: OidcConfig, idToken: string, nonce: string) {
    const doc = await this.metadata(config);
    if (this.keys?.jwksUri !== doc.jwks_uri) this.keys = {jwksUri: doc.jwks_uri, get: createRemoteJWKSet(new URL(doc.jwks_uri), {timeoutDuration: HTTP_TIMEOUT_MS, cacheMaxAge: 600_000, cooldownDuration: 30_000})};
    let payload: Record<string, unknown>;
    try {
      ({payload} = await jwtVerify(idToken, this.keys.get, {issuer: config.issuer, audience: config.clientId, algorithms: ALGORITHMS, clockTolerance: 120, maxTokenAge: '10m', requiredClaims: ['sub', 'iat', 'exp']}));
    } catch (error) { throw new OidcError('token-invalid', `id_token 校验失败：${(error as {code?: string}).code ?? (error as Error).message}`); }
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audience.length > 1 && payload.azp !== config.clientId) throw new OidcError('token-invalid', 'id_token 含多个 audience 但 azp 不是本客户端');
    if (payload.azp !== undefined && payload.azp !== config.clientId) throw new OidcError('token-invalid', 'id_token 签发给了其他客户端');
    if (payload.nonce !== nonce) throw new OidcError('token-invalid', 'id_token 的 nonce 与本次登录不符');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new OidcError('token-invalid', 'id_token 缺少 sub');
    const email = payload.email_verified === true && typeof payload.email === 'string' ? payload.email.slice(0, 254) : null;
    return {subject: payload.sub, email};
  }
}
