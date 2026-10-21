// OIDC 失败代码（服务器通过 URL 片段返回）对应的提示。
const messages: Record<string, string> = {
  'misconfigured': 'OIDC 配置有误，请检查服务器日志与 OIDC_* 环境变量。',
  'provider-unreachable': '无法连接身份提供方，请稍后重试。',
  'state-invalid': '登录已过期或不是从本浏览器发起，请重新开始。',
  'provider-refused': '身份提供方拒绝了授权。',
  'token-invalid': '身份提供方返回的凭证未通过校验。',
  'not-linked': '该身份尚未绑定 useeCard 账号。请先用密码登录，在「设置 → 账号安全」中绑定。',
  'identity-in-use': '该身份已绑定到其他账号。',
  'session-ended': '发起绑定的登录已失效，请重新登录后再绑定。',
  'rate-limited': '尝试次数过多，请稍后重试。',
};
export const oidcMessage = (code: string) => messages[code] ?? '单点登录失败，请重试。';
/** 读取并清除 URL 片段中的结果代码。 */
export function takeHashParam(name: string) {
  const value = new URLSearchParams(window.location.hash.slice(1)).get(name);
  if (value !== null) history.replaceState(history.state, '', window.location.pathname + window.location.search);
  return value;
}
