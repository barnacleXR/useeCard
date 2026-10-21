import 'reflect-metadata';
import { AppriseService } from './notifications/apprise.service.js';
import { ChannelsController } from './notifications/channels.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { Module, type HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, {type Request, type Response} from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseService } from './database.js';
import { MaintenanceService } from './data-management/maintenance.service.js';
import { BackupService } from './data-management/backup.service.js';
import { ExportService } from './data-management/export.service.js';
import { DataController } from './data-management/data.controller.js';
import { Errors } from './common/errors.js';
import { LedgerService } from './common/ledger.service.js';
import { RateLimitService } from './common/security.js';
import { SafeFetchService } from './common/safe-fetch.js';
import { AssetsController } from './assets/assets.controller.js';
import { AssetsService } from './assets/assets.service.js';
import { BanksService } from './banks/banks.service.js';
import { AppAuthController } from './devices/app-auth.controller.js';
import { DevicesController } from './devices/devices.controller.js';
import { DevicesService } from './devices/devices.service.js';
import { RemindersService } from './reminders/reminders.service.js';
import { AuditController } from './auth/audit.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { ApiKeysController } from './public-api/api-keys.controller.js';
import { ApiKeysService } from './public-api/api-keys.service.js';
import { PublicApiController, type ApiKeyRequest } from './public-api/public-api.controller.js';
import { AuthService, type AuthRequest } from './auth/auth.service.js';
import { AccountsController } from './accounts/accounts.controller.js';
import { AccountsService } from './accounts/accounts.service.js';
import { BillsController } from './bills/bills.controller.js';
import { BillsService } from './bills/bills.service.js';
import { ReviewsController } from './reviews/reviews.controller.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { SettingsService } from './settings/settings.service.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { mcpScopes } from '@ccm/shared';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthService, oauthUrls } from './oauth/oauth.service.js';
import { oauthClientAuth } from './oauth/client-auth.middleware.js';
import { McpService } from './mcp/mcp.service.js';
import { OidcController } from './oidc/oidc.controller.js';
import { OidcService } from './oidc/oidc.service.js';

@Module({
  controllers: [OidcController, OAuthController, ApiKeysController, PublicApiController, ChannelsController, NotificationsController, AuditController, DataController, AuthController, AppAuthController, DevicesController, AssetsController, AccountsController, BillsController, ReviewsController, ReportsController, SettingsController],
  providers: [OidcService, OAuthService, McpService, ApiKeysService, AppriseService, NotificationsService, MaintenanceService, BackupService, ExportService, DatabaseService, LedgerService, RateLimitService, {provide: SafeFetchService, useFactory: () => new SafeFetchService()}, AuthService, DevicesService, AssetsService, BanksService, AccountsService, BillsService, ReviewsService, ReportsService, RemindersService, SettingsService],
})
class AppModule {}

const V1_PREFIX = '/api/v1/';
const V1_PUBLIC = ['/api/v1/openapi.json'];
const APP_PREFIX = '/api/app/v1/';
const APP_PUBLIC = ['server-info', 'auth/login', 'auth/pair', 'auth/refresh'].map(path => APP_PREFIX + path);
// MCP 与 OAuth 端点由 SDK 处理：凭证是 Bearer 令牌或客户端密钥，不读 Cookie，因此不做 Origin 校验。
const OAUTH_PATHS = ['/authorize', '/token', '/register', '/revoke', '/mcp'];
const isOAuthPath = (path: string) => OAUTH_PATHS.includes(path) || path.startsWith('/.well-known/oauth-');
const WEB_PUBLIC = ['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/oidc/start', '/api/auth/oidc/callback'];

/**
 * 反向代理信任范围（Express trust proxy 语法）。默认信任本机与内网地址：
 * 经 Caddy/Nginx 或 Docker 端口转发进来的请求按 X-Forwarded-For 取访客真实 IP，用于登录限流。
 * 直接暴露端口给不可信网络时应设为 false。
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): boolean | number | string {
  const value = (raw ?? '').trim();
  if (!value) return 'loopback, linklocal, uniquelocal';
  if (/^(false|0|off|no)$/i.test(value)) return false;
  if (/^(true|on|yes)$/i.test(value)) return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export async function createApp() {
  const app = await NestFactory.create(AppModule, {logger: false, bodyParser: false});
  (app.getHttpAdapter().getInstance() as express.Application).set('trust proxy', trustProxySetting());
  const maintenance = app.get(MaintenanceService);
  const auth = app.get(AuthService); const devices = app.get(DevicesService); const apiKeys = app.get(ApiKeysService);
  const oauth = app.get(OAuthService); const mcp = app.get(McpService);
  // 图标上传为 base64 data URL（图片上限 512 KB），仅该接口放宽请求体。
  app.use(['/api/assets', '/api/app/v1/assets'], express.json({limit: '1mb'}));
  const json = express.json({limit: '128kb'});
  app.use((req: Request, res: Response, next: () => void) => req.path === '/api/data/restore' ? next() : json(req,res,next));
  app.use((req: AuthRequest, res: Response, next: (error?: unknown) => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if ((req.path.startsWith('/api/') || isOAuthPath(req.path)) && !maintenance.track(res)) { res.setHeader('Retry-After','5'); res.status(503).json({message:'正在恢复备份，请稍后重试'}); return; }
    const write = !['GET','HEAD','OPTIONS'].includes(req.method);
    if (write && !isOAuthPath(req.path)) {
      const allowed = new URL(process.env.BASE_URL || 'http://localhost:5173').origin;
      if (req.headers.origin && req.headers.origin !== allowed) { res.status(403).json({message: '请求来源不匹配'}); return; }
    }
    if (!req.path.startsWith('/api/')) { next(); return; }
    // 只读 REST API v1：只认 API Key，按 Key 限流；Cookie、设备令牌与 MCP 令牌一律拒绝。
    if (req.path.startsWith(V1_PREFIX)) {
      if (V1_PUBLIC.includes(req.path)) { next(); return; }
      if (req.method !== 'GET') { res.status(405).setHeader('Allow', 'GET'); res.json({message: 'API v1 只读'}); return; }
      try {
        const key = apiKeys.authenticate(req.headers.authorization);
        const wait = apiKeys.hit(key.keyId);
        if (wait) { res.setHeader('Retry-After', String(wait)); res.status(429).json({message: `请求过于频繁，请 ${wait} 秒后重试`}); return; }
        req.ownerId = key.ownerId; (req as ApiKeyRequest).apiScopes = key.scopes; next();
      } catch (error) { res.status(401).json({message: (error as Error).message}); }
      return;
    }
    // 原生 App：只认设备 Bearer 令牌，不接受 Web Cookie；无 Cookie 即无 CSRF 风险。
    if (req.path.startsWith(APP_PREFIX)) {
      if (APP_PUBLIC.includes(req.path)) { next(); return; }
      try { const session = devices.authenticate(req.headers.authorization); req.ownerId = session.ownerId; req.deviceId = session.deviceId; next(); }
      catch (error) { res.status(401).json({message: (error as Error).message}); }
      return;
    }
    // Web：只认 HttpOnly 会话 Cookie，写操作校验 CSRF。
    if (WEB_PUBLIC.includes(req.path)) { next(); return; }
    try { req.ownerId = auth.authenticate(req, write).ownerId; next(); }
    catch (error) { const status = 403 === (error as HttpException).getStatus?.() ? 403 : 401; if (status === 401) res.setHeader('X-CCM-Session-Expired','1'); res.status(status).json({message: (error as Error).message}); }
  });
  // MCP 授权服务器（授权码 + PKCE、动态注册、元数据）与受保护资源 /mcp。
  const {issuer, resource} = oauthUrls();
  const clientAuth = [express.urlencoded({extended: false, limit: '16kb'}), oauthClientAuth(oauth)];
  app.use('/token', ...clientAuth); app.use('/revoke', ...clientAuth);
  app.use(mcpAuthRouter({provider: oauth, issuerUrl: issuer, resourceServerUrl: resource, scopesSupported: [...mcpScopes], resourceName: 'useeCard',
    clientRegistrationOptions: {clientSecretExpirySeconds: 0}}));
  const bearer = requireBearerAuth({verifier: oauth, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource), expectedResource: resource});
  app.use('/mcp', (req: Request, res: Response, next: () => void) => {
    if (req.method === 'POST') { next(); return; }
    // 无状态模式：不提供 SSE 流与会话删除。
    res.setHeader('Allow', 'POST'); res.status(405).json({jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed'}, id: null});
  }, bearer, (req: Request, res: Response) => { void mcp.handle(req, res).catch(() => { if (!res.headersSent) res.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: 'Internal error'}, id: null}); }); });
  // 恢复请求先验证会话和 CSRF，再接收最多约 86 MB 的备份封装。
  app.use('/api/data/restore',express.json({limit:'90mb'}));
  app.useGlobalFilters(new Errors());
  const client = resolve(process.env.CLIENT_DIST || '../client/dist');
  if (existsSync(client)) {
    app.use(express.static(client));
    app.use((req: Request, res: Response, next: () => void) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) res.sendFile('index.html', {root: client}); // 用 root：部署路径含点目录时绝对路径会被当作隐藏文件拒绝。
      else next();
    });
  }
  app.enableShutdownHooks();
  await app.init();
  return app;
}
