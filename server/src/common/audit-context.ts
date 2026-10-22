import { AsyncLocalStorage } from 'node:async_hooks';

export type AuditSource = 'web' | 'ios' | 'rest' | 'mcp' | 'system' | 'unknown';
export interface AuditContext { source: AuditSource; authMethod: string; ip: string; userAgent: string; location: string }
export const auditContext = new AsyncLocalStorage<AuditContext>();

// 位置只接受可信代理提供的国家/地区粗粒度值；不记录未经验证的用户输入。
export function requestLocation(headers: Record<string, unknown>, trusted: boolean) {
  if (!trusted) return '';
  const value = headers['cf-ipcountry'];
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : '';
}
