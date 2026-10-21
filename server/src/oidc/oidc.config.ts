export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const VARS = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_SCOPES', 'OIDC_NAME'];

export interface OidcConfig { issuer: string; clientId: string; clientSecret: string | null; redirectUri: string; scopes: string; name: string }
export type OidcConfigResult = {on: true; config: OidcConfig} | {on: false; error?: string};

/** http 只允许浏览器视为安全上下文的本机地址。 */
export function allowsPlainHttp(url: URL) { return LOCAL_HOSTS.has(url.hostname.toLowerCase()); }

/**
 * 从环境变量读取 OIDC 配置。未设置任何 OIDC_* 时为关闭；配置不完整或有误时同样关闭并给出原因，
 * 不影响密码登录。客户端密钥不会出现在返回的错误信息中。
 */
export function readOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfigResult {
  const read = (name: string) => (env[name] ?? '').trim();
  const issuer = read('OIDC_ISSUER'), clientId = read('OIDC_CLIENT_ID'), scopes = read('OIDC_SCOPES') || 'openid profile email';
  if (!issuer) {
    const present = VARS.filter(read);
    return present.length ? {on: false, error: `已设置 ${present.join(', ')}，但缺少 OIDC_ISSUER`} : {on: false};
  }
  if (!clientId) return {on: false, error: '缺少 OIDC_CLIENT_ID'};
  let issuerUrl: URL;
  try { issuerUrl = new URL(issuer); } catch { return {on: false, error: `OIDC_ISSUER=${issuer} 不是有效地址`}; }
  if (issuerUrl.protocol !== 'https:' && !(issuerUrl.protocol === 'http:' && allowsPlainHttp(issuerUrl))) return {on: false, error: 'OIDC_ISSUER 必须是 https 地址（本机地址可用 http）'};
  if (issuerUrl.username || issuerUrl.password) return {on: false, error: 'OIDC_ISSUER 不能包含用户名或密码'};
  if (issuerUrl.search || issuerUrl.hash) return {on: false, error: 'OIDC_ISSUER 不能包含查询参数或 #'};
  // issuer 与提供方发现文档中的 issuer 逐字节比较，因此不自动去掉结尾斜杠。
  if (issuer.endsWith('/')) return {on: false, error: 'OIDC_ISSUER 不能以 / 结尾'};

  const base = read('BASE_URL');
  if (!base) return {on: false, error: '启用 OIDC 需要设置 BASE_URL（回调地址由它生成）'};
  let origin: URL;
  try { origin = new URL(base); } catch { return {on: false, error: `BASE_URL=${base} 不是有效地址`}; }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && allowsPlainHttp(origin))) return {on: false, error: 'BASE_URL 必须是 https 地址（本机地址可用 http）'};

  let redirectUri = origin.origin + OIDC_CALLBACK_PATH;
  const explicit = read('OIDC_REDIRECT_URI');
  if (explicit) {
    let url: URL;
    try { url = new URL(explicit); } catch { return {on: false, error: `OIDC_REDIRECT_URI=${explicit} 不是有效地址`}; }
    if (url.origin !== origin.origin || url.hash || url.username || url.password) return {on: false, error: 'OIDC_REDIRECT_URI 必须与 BASE_URL 同源，且不能包含 # 或凭证'};
    redirectUri = url.href;
  }
  if (!scopes.split(/\s+/).includes('openid')) return {on: false, error: 'OIDC_SCOPES 必须包含 openid'};
  return {on: true, config: {issuer, clientId, clientSecret: read('OIDC_CLIENT_SECRET') || null, redirectUri, scopes, name: read('OIDC_NAME') || issuerUrl.hostname}};
}
