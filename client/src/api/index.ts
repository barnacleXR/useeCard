let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {method, credentials: 'same-origin', headers: {'Content-Type': 'application/json', ...(csrf ? {'X-CSRF-Token': csrf} : {}), ...(key ? {'Idempotency-Key': key} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
  if (response.status === 401 && response.headers.get('X-CCM-Session-Expired') === '1') window.dispatchEvent(new Event('ccm-session-expired'));
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `请求失败（${response.status}）`);
  return data as T;
}
