import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mcpReadScopes, mcpScopes, oauthApproveInput, oauthClientCreateInput, type McpConnectionInfo, type McpScope, type OAuthClientInfo, type OAuthGrantInfo, type OAuthPendingRequest } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { hashToken, randomToken } from '../common/security.js';

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_MS = 30 * 86400_000;
const CODE_TTL_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;

/** 服务地址：issuer 为 BASE_URL 的源，MCP 资源（令牌 audience）为 `${issuer}/mcp`。 */
export function oauthUrls() {
  const issuer = new URL(new URL(process.env.BASE_URL || 'http://localhost:5173').origin);
  return {issuer, resource: new URL('/mcp', issuer)};
}

interface ClientRow { id: string; name: string; redirectUris: string; secretHash: string | null; source: 'dcr' | 'manual'; createdAt: string; revokedAt: string | null }
interface GrantRow { id: string; clientId: string; userId: string; scopes: string; accessExpiresAt: number; refreshExpiresAt: number; revokedAt: string | null }
interface Pending { clientId: string; clientName: string; redirectUri: string; state?: string; scopes: McpScope[]; codeChallenge: string; expiresAt: number }

// OAuth 协议错误会进入 error_description 与 WWW-Authenticate 头，RFC 6749 要求 ASCII，因此用英文。
// 回调地址只允许 https、本机 http 或原生 App 的自定义 scheme；拒绝 javascript:/data: 等危险协议。
function assertRedirectUri(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new InvalidClientMetadataError(`invalid redirect_uri: ${raw}`); }
  const scheme = url.protocol.replace(':', '');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (['javascript', 'data', 'file', 'vbscript', 'blob'].includes(scheme)) throw new InvalidClientMetadataError(`redirect_uri scheme not allowed: ${scheme}`);
  if (scheme === 'http' && !loopback) throw new InvalidClientMetadataError('http redirect_uri is only allowed for loopback hosts; use https');
  if (url.hash) throw new InvalidClientMetadataError('redirect_uri must not contain a fragment');
}

/**
 * MCP 的 OAuth 授权服务器（授权码 + PKCE）。HTTP 端点与 PKCE 校验由官方 SDK 路由处理，
 * 客户端、授权码与令牌的存储和发放在此实现：凭证只存哈希，刷新令牌每次轮换，重放旧刷新令牌吊销整个授权。
 */
@Injectable()
export class OAuthService implements OAuthServerProvider {
  private readonly pending = new Map<string, Pending>();
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}
  private get db() { return this.ledger.db; }

  connectionInfo(): McpConnectionInfo {
    const {issuer, resource} = oauthUrls();
    return {endpoint: resource.href, issuer: issuer.href, resourceMetadata: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href,
      authorizationServerMetadata: new URL('/.well-known/oauth-authorization-server', issuer).href, scopes: [...mcpScopes]};
  }

  // ---------- 客户端 ----------

  private toSdkClient(row: ClientRow): OAuthClientInformationFull {
    // 不把 client_secret 交给 SDK（SDK 会按明文比对）；密钥由 oauth-client-auth 中间件按哈希预先校验。
    return {client_id: row.id, client_name: row.name, redirect_uris: JSON.parse(row.redirectUris), grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: mcpScopes.join(' ')};
  }

  clientRow(id: string) { return this.db.prepare('SELECT * FROM oauth_clients WHERE id=? AND revokedAt IS NULL').get(id) as ClientRow | undefined; }

  /** 校验机密客户端的密钥；公共客户端（无密钥）直接通过。 */
  verifyClientSecret(clientId: string, secret: string | undefined): 'ok' | 'unknown' | 'missing' | 'invalid' {
    const row = this.clientRow(clientId);
    if (!row) return 'unknown';
    if (!row.secretHash) return 'ok';
    if (!secret) return 'missing';
    const expected = Buffer.from(row.secretHash, 'hex'), actual = Buffer.from(hashToken(secret), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? 'ok' : 'invalid';
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId: string) => { const row = this.clientRow(clientId); return row ? this.toSdkClient(row) : undefined; },
      // 动态客户端登记（RFC 7591）：SDK 生成 client_id 与可能的密钥；只保存密钥哈希，明文仅随本次响应返回。
      registerClient: (client) => {
        const info = client as OAuthClientInformationFull;
        info.redirect_uris.forEach(uri => assertRedirectUri(String(uri)));
        const id = info.client_id || randomUUID();
        this.db.prepare('INSERT INTO oauth_clients(id,name,redirectUris,secretHash,source,createdAt) VALUES(?,?,?,?,?,?)')
          .run(id, (info.client_name || 'MCP 客户端').slice(0, 80), JSON.stringify(info.redirect_uris.map(String)), info.client_secret ? hashToken(info.client_secret) : null, 'dcr', new Date().toISOString());
        return {...info, client_id: id};
      },
    };
  }

  /** 设置页手动登记；机密客户端的密钥只返回一次。 */
  createClient(owner: string, body: unknown) {
    const input = oauthClientCreateInput.parse(body);
    try { input.redirectUris.forEach(assertRedirectUri); } catch (error) { throw new BadRequestException((error as Error).message); }
    const id = randomUUID(); const secret = input.confidential ? randomBytes(32).toString('hex') : undefined;
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO oauth_clients(id,name,redirectUris,secretHash,source,createdBy,createdAt) VALUES(?,?,?,?,?,?,?)')
        .run(id, input.name, JSON.stringify(input.redirectUris), secret ? hashToken(secret) : null, 'manual', owner, new Date().toISOString());
      this.ledger.audit(owner, 'oauth.client.create', id, {name: input.name, redirectUris: input.redirectUris, confidential: input.confidential});
    })();
    return {clientId: id, clientSecret: secret ?? null};
  }

  listClients(owner: string): OAuthClientInfo[] {
    const rows = this.db.prepare('SELECT * FROM oauth_clients WHERE revokedAt IS NULL ORDER BY createdAt DESC').all() as ClientRow[];
    const active = this.db.prepare('SELECT count(*) AS n FROM oauth_grants WHERE clientId=? AND userId=? AND revokedAt IS NULL AND refreshExpiresAt>?');
    return rows.map(row => ({id: row.id, name: row.name, redirectUris: JSON.parse(row.redirectUris), source: row.source, confidential: !!row.secretHash, createdAt: row.createdAt,
      activeGrants: (active.get(row.id, owner, Date.now()) as {n: number}).n}));
  }

  deleteClient(owner: string, id: string) {
    this.db.transaction(() => {
      const result = this.db.prepare('UPDATE oauth_clients SET revokedAt=? WHERE id=? AND revokedAt IS NULL').run(new Date().toISOString(), id);
      if (!result.changes) throw new NotFoundException('客户端不存在');
      this.db.prepare("UPDATE oauth_grants SET revokedAt=?,revokedReason='client_deleted' WHERE clientId=? AND revokedAt IS NULL").run(new Date().toISOString(), id);
      this.ledger.audit(owner, 'oauth.client.delete', id, {});
    })();
    return {ok: true};
  }

  // ---------- 授权页 ----------

  /** SDK 已校验 client、redirect_uri 与 PKCE 参数；这里登记待确认请求并转到需要 Web 登录的授权页。 */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const back = new URL(params.redirectUri);
    if (params.state) back.searchParams.set('state', params.state);
    if (params.resource && params.resource.href !== oauthUrls().resource.href) {
      back.searchParams.set('error', 'invalid_target'); back.searchParams.set('error_description', 'resource must be this server\'s /mcp endpoint');
      res.redirect(302, back.href); return;
    }
    const requested = (params.scopes ?? []).filter((s): s is McpScope => (mcpScopes as readonly string[]).includes(s));
    this.prunePending();
    const id = randomBytes(18).toString('base64url');
    this.pending.set(id, {clientId: client.client_id, clientName: client.client_name || 'MCP 客户端', redirectUri: params.redirectUri, state: params.state,
      scopes: requested, codeChallenge: params.codeChallenge, expiresAt: Date.now() + PENDING_TTL_MS});
    res.redirect(302, `/oauth/consent?request=${encodeURIComponent(id)}`);
  }

  private prunePending() { const now = Date.now(); for (const [id, p] of this.pending) if (p.expiresAt < now) this.pending.delete(id); }
  private takePending(id: string) {
    this.prunePending();
    const p = this.pending.get(id);
    if (!p) throw new NotFoundException('授权请求不存在或已过期，请回到客户端重新连接');
    return p;
  }

  pendingRequest(id: string): OAuthPendingRequest {
    const p = this.takePending(id);
    // 默认只勾选只读；写入权限即使客户端申请了，也需要用户在授权页手动勾选。
    const reads = p.scopes.filter(s => mcpReadScopes.includes(s));
    return {id, clientId: p.clientId, clientName: p.clientName, redirectHost: new URL(p.redirectUri).host || p.redirectUri, requestedScopes: p.scopes,
      defaultScopes: reads.length ? reads : [...mcpReadScopes], expiresAt: new Date(p.expiresAt).toISOString()};
  }

  approve(owner: string, id: string, body: unknown): {redirectUrl: string} {
    const {scopes} = oauthApproveInput.parse(body);
    const p = this.takePending(id); this.pending.delete(id);
    const code = randomToken('ccmc');
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO oauth_codes(codeHash,clientId,userId,scopes,codeChallenge,redirectUri,expiresAt,createdAt) VALUES(?,?,?,?,?,?,?,?)')
        .run(hashToken(code), p.clientId, owner, JSON.stringify(scopes), p.codeChallenge, p.redirectUri, Date.now() + CODE_TTL_MS, new Date().toISOString());
      this.ledger.audit(owner, 'oauth.authorize', p.clientId, {scopes});
    })();
    const url = new URL(p.redirectUri);
    url.searchParams.set('code', code);
    if (p.state) url.searchParams.set('state', p.state);
    url.searchParams.set('iss', oauthUrls().issuer.href.replace(/\/$/, ''));
    return {redirectUrl: url.href};
  }

  deny(id: string): {redirectUrl: string} {
    const p = this.takePending(id); this.pending.delete(id);
    const url = new URL(p.redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (p.state) url.searchParams.set('state', p.state);
    return {redirectUrl: url.href};
  }

  // ---------- 令牌 ----------

  private codeRow(client: OAuthClientInformationFull, code: string) {
    const row = this.db.prepare('SELECT * FROM oauth_codes WHERE codeHash=?').get(hashToken(code)) as {codeHash: string; clientId: string; userId: string; scopes: string; codeChallenge: string; redirectUri: string; expiresAt: number; consumedAt: string | null} | undefined;
    if (!row || row.clientId !== client.client_id || row.expiresAt <= Date.now()) throw new InvalidGrantError('authorization code is invalid or expired');
    return row;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) { return this.codeRow(client, code).codeChallenge; }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const row = this.codeRow(client, code);
    if (redirectUri && redirectUri !== row.redirectUri) throw new InvalidGrantError('redirect_uri does not match the authorization request');
    if (resource && resource.href !== oauthUrls().resource.href) throw new InvalidTargetError('resource must be this server\'s /mcp endpoint');
    // 授权码只能使用一次；重复使用视为泄露，吊销由它签发的授权（RFC 6749 §4.1.2）。
    const tokens = this.db.transaction(() => {
      const consumed = this.db.prepare('UPDATE oauth_codes SET consumedAt=? WHERE codeHash=? AND consumedAt IS NULL').run(new Date().toISOString(), row.codeHash);
      if (!consumed.changes) {
        this.db.prepare("UPDATE oauth_grants SET revokedAt=?,revokedReason='code_reuse' WHERE codeHash=? AND revokedAt IS NULL").run(new Date().toISOString(), row.codeHash);
        return undefined;
      }
      return this.issue(row.userId, row.clientId, JSON.parse(row.scopes), row.codeHash);
    })();
    if (!tokens) throw new InvalidGrantError('authorization code has already been used');
    return tokens;
  }

  private issue(userId: string, clientId: string, scopes: McpScope[], codeHash: string | null): OAuthTokens {
    const access = randomToken('ccmo'); const refresh = randomToken('ccmor'); const now = Date.now();
    this.db.prepare('INSERT INTO oauth_grants(id,clientId,userId,scopes,accessHash,accessExpiresAt,refreshHash,refreshExpiresAt,codeHash,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), clientId, userId, JSON.stringify(scopes), hashToken(access), now + ACCESS_TTL_S * 1000, hashToken(refresh), now + REFRESH_TTL_MS, codeHash, new Date(now).toISOString());
    return {access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ')};
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    if (resource && resource.href !== oauthUrls().resource.href) throw new InvalidTargetError('resource must be this server\'s /mcp endpoint');
    const presented = hashToken(refreshToken); const now = Date.now();
    // 吊销在事务内提交，再在事务外抛错。
    const result = this.db.transaction((): OAuthTokens | 'reused' | 'invalid' | 'scope' => {
      const reused = this.db.prepare('SELECT id FROM oauth_grants WHERE previousRefreshHash=? AND revokedAt IS NULL').get(presented) as {id: string} | undefined;
      if (reused) { this.db.prepare("UPDATE oauth_grants SET revokedAt=?,revokedReason='refresh_reuse' WHERE id=?").run(new Date().toISOString(), reused.id); return 'reused'; }
      const row = this.db.prepare('SELECT * FROM oauth_grants WHERE refreshHash=?').get(presented) as GrantRow | undefined;
      if (!row || row.revokedAt || row.clientId !== client.client_id || row.refreshExpiresAt <= now || !this.clientRow(row.clientId)) return 'invalid';
      const granted = JSON.parse(row.scopes) as McpScope[];
      // 刷新时只能缩小权限，不能扩大。
      if (scopes?.some(s => !(granted as string[]).includes(s))) return 'scope';
      const next = scopes?.length ? scopes as McpScope[] : granted;
      const access = randomToken('ccmo'); const refresh = randomToken('ccmor');
      this.db.prepare('UPDATE oauth_grants SET scopes=?,accessHash=?,accessExpiresAt=?,refreshHash=?,previousRefreshHash=?,refreshExpiresAt=?,lastUsedAt=? WHERE id=?')
        .run(JSON.stringify(next), hashToken(access), now + ACCESS_TTL_S * 1000, hashToken(refresh), presented, now + REFRESH_TTL_MS, new Date(now).toISOString(), row.id);
      return {access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: next.join(' ')};
    })();
    if (result === 'scope') throw new InvalidScopeError('refresh cannot add scopes');
    if (typeof result === 'string') throw new InvalidGrantError('refresh token is invalid, expired or revoked');
    return result;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token.startsWith('ccmo_')) throw new InvalidTokenError('not an MCP access token issued by this server');
    const row = this.db.prepare('SELECT * FROM oauth_grants WHERE accessHash=?').get(hashToken(token)) as GrantRow | undefined;
    if (!row || row.revokedAt || !this.clientRow(row.clientId)) throw new InvalidTokenError('access token is invalid or revoked');
    if (row.accessExpiresAt <= Date.now()) throw new InvalidTokenError('access token expired');
    this.db.prepare('UPDATE oauth_grants SET lastUsedAt=? WHERE id=?').run(new Date().toISOString(), row.id);
    return {token, clientId: row.clientId, scopes: JSON.parse(row.scopes), expiresAt: Math.floor(row.accessExpiresAt / 1000), resource: oauthUrls().resource, extra: {userId: row.userId, grantId: row.id}};
  }

  /** RFC 7009：未知令牌也返回成功，避免探测。 */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const hash = hashToken(request.token);
    this.db.prepare("UPDATE oauth_grants SET revokedAt=?,revokedReason='client_revoke' WHERE clientId=? AND (accessHash=? OR refreshHash=?) AND revokedAt IS NULL")
      .run(new Date().toISOString(), client.client_id, hash, hash);
  }

  // ---------- 已授权连接 ----------

  listGrants(owner: string): OAuthGrantInfo[] {
    return (this.db.prepare(`SELECT g.id,g.clientId,c.name AS clientName,g.scopes,g.createdAt,g.lastUsedAt FROM oauth_grants g JOIN oauth_clients c ON c.id=g.clientId
      WHERE g.userId=? AND g.revokedAt IS NULL AND g.refreshExpiresAt>? AND c.revokedAt IS NULL ORDER BY g.createdAt DESC`).all(owner, Date.now()) as (Omit<OAuthGrantInfo, 'scopes'> & {scopes: string})[])
      .map(row => ({...row, scopes: JSON.parse(row.scopes)}));
  }

  revokeGrant(owner: string, id: string) {
    this.db.transaction(() => {
      const result = this.db.prepare("UPDATE oauth_grants SET revokedAt=?,revokedReason='user' WHERE id=? AND userId=? AND revokedAt IS NULL").run(new Date().toISOString(), id, owner);
      if (!result.changes) throw new NotFoundException('连接不存在或已撤销');
      this.ledger.audit(owner, 'oauth.grant.revoke', id, {});
    })();
    return {ok: true};
  }
}
