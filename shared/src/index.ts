import { z } from 'zod';

export const currencies = { JPY: 0, CNY: 2, USD: 2, EUR: 2, GBP: 2, HKD: 2, TWD: 2, KRW: 0 } as const;
export type Currency = keyof typeof currencies;
export const currencySchema = z.enum(Object.keys(currencies) as [Currency, ...Currency[]]);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份须为 YYYY-MM');
export const dateSchema = z.string().refine(value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, '请输入合法的完整日期');
export const nameSchema = z.string().trim().min(1).max(100);
export const cardBrands = ['visa', 'mastercard', 'jcb', 'amex', 'diners', 'discover', 'unionpay', 'maestro'] as const;
export type CardBrand = typeof cardBrands[number];
const iconAssetSchema = z.string().uuid().nullable().default(null);
export const accountInput = z.object({ name: nameSchema, bankName: z.string().trim().max(100).default(''), bankCode: z.string().regex(/^(\d{4})?$/, '金融机构代码须为 4 位数字').default(''), iconAssetId: iconAssetSchema, note: z.string().max(1000).default('') }).strict();
export const cardInput = z.object({ name: nameSchema, issuer: z.string().max(100).default(''), last4: z.string().regex(/^(\d{4})?$/).default(''), defaultDebitAccountId: z.string().uuid(), defaultCurrency: currencySchema, frequency: z.enum(['regular', 'low']).default('regular'), brand: z.enum(['', ...cardBrands]).default(''), iconAssetId: iconAssetSchema, note: z.string().max(1000).default('') }).strict();
export const versionInput = z.object({ version: z.number().int().positive() });
export const reorderInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();
export const billStatusSchema = z.enum(['pending', 'paid', 'void']);
const optionalQuery = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(value => value === '' ? undefined : value, schema.optional());
// 账单页查询：日期为实际扣款日闭区间，页码从 1 开始。
export const billSearchInput = z.object({
  from: optionalQuery(dateSchema), to: optionalQuery(dateSchema), cardId: optionalQuery(z.string().uuid()), accountId: optionalQuery(z.string().uuid()),
  currency: optionalQuery(currencySchema), status: optionalQuery(billStatusSchema),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(q => !q.from || !q.to || q.from <= q.to, '开始日期不能晚于结束日期');
export type BillSearch = z.input<typeof billSearchInput>;
export const billInput = z.object({ cardId: z.string().uuid(), debitAccountId: z.string().uuid(), amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: currencySchema, dueDate: dateSchema, statementMonth: monthSchema.nullable().default(null), note: z.string().max(1000).default('') }).strict();
export const credentialsInput = z.object({ username: nameSchema, password: z.string().min(12, '密码至少 12 位').max(128) }).strict();
export type BillInput = z.infer<typeof billInput>;
// 原生设备：名称用于设备列表展示；配对码大小写与分隔符不敏感。
const deviceFields = { deviceName: z.string().trim().min(1).max(100), platform: z.enum(['ios', 'other']).default('ios') };
export const deviceLoginInput = z.object({ username: nameSchema, password: z.string().min(1).max(128), ...deviceFields }).strict();
export const pairInput = z.object({ code: z.string().trim().min(8).max(20), ...deviceFields }).strict();
export const refreshInput = z.object({ refreshToken: z.string().min(10).max(200) }).strict();
export const preferencesInput = z.object({
  inAppNotifications: z.boolean().optional(), defaultCurrency: currencySchema.optional(), reminderDaysBefore: z.number().int().min(0).max(30).optional(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间须为 HH:MM').optional(),
}).strict().refine(v => Object.keys(v).length > 0, '至少提交一项设置');
export interface Preferences { username: string; defaultCurrency: Currency; reminderDaysBefore: number; reminderTime: string; inAppNotifications: boolean }
export interface ServerInfo { service: 'useecard'; instanceId: string; name: string; appApiVersion: number; authMethods: ('password' | 'pairing')[] }
export interface DeviceTokens { tokenType: 'Bearer'; accessToken: string; accessExpiresAt: string; refreshToken: string; refreshExpiresAt: string; instanceId: string; user: {id: string; username: string}; device: {id: string; name: string} }
export interface DeviceSession { id: string; name: string; platform: string; method: 'password' | 'pairing'; createdAt: string; lastUsedAt: string | null; current?: boolean }
export interface PairingCode { code: string; expiresAt: string }
export interface ReminderItem { key: string; accountId: string; accountName: string; dueDate: string; currency: Currency; amountMinor: number; billCount: number; notifyDate: string; notifyTime: string }
export interface ReminderPlan { generatedAt: string; today: string; daysBefore: number; notifyTime: string; items: ReminderItem[]; truncated: boolean }
export interface Account { id: string; name: string; bankName: string; bankCode: string; iconAssetId: string | null; note: string; sortOrder: number; version: number; archivedAt: string | null }
export interface Card { id: string; name: string; issuer: string; last4: string; defaultDebitAccountId: string; defaultCurrency: Currency; frequency: 'regular' | 'low'; brand: CardBrand | ''; iconAssetId: string | null; note: string; sortOrder: number; version: number; archivedAt: string | null }
export interface Bill extends BillInput { id: string; status: 'pending' | 'paid' | 'void'; version: number; paidAt: string | null; createdAt: string; updatedAt: string; cardName: string; accountName: string }
export const assetFetchInput = z.object({ url: z.string().trim().url().max(2000) }).strict();
export const siteIconInput = z.object({ domain: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, '请输入网站域名，例如 smbc.co.jp') }).strict();
export const assetUploadInput = z.object({ dataUrl: z.string().max(1_000_000).regex(/^data:image\/[a-z0-9.+-]+;base64,/, '请上传图片') }).strict();
export interface Asset { id: string; mime: string; size: number; source: 'upload' | 'url' | 'site'; sourceUrl: string | null }
export interface BankEntry { code: string; name: string; kana: string; domain: string | null }
// 只读 REST API v1：独立 API Key 与权限范围（只读）。
export const apiScopes = ['accounts:read', 'cards:read', 'bills:read', 'summary:read', 'reviews:read'] as const;
export type ApiScope = typeof apiScopes[number];
export const apiKeyCreateInput = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(apiScopes)).min(1).max(apiScopes.length).transform(list => [...new Set(list)]),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
}).strict();
// MCP（OAuth）权限：只读与 REST 一致，另有明确授予的写入权限。
export const mcpScopes = [...apiScopes, 'bills:write', 'reviews:write'] as const;
export type McpScope = typeof mcpScopes[number];
export const mcpReadScopes: readonly McpScope[] = apiScopes;
export const oauthApproveInput = z.object({ scopes: z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length).transform(list => [...new Set(list)]) }).strict();
export const oauthClientCreateInput = z.object({
  name: z.string().trim().min(1).max(80),
  redirectUris: z.array(z.string().trim().url().max(500)).min(1).max(10),
  confidential: z.boolean().default(false),
}).strict();
export interface OAuthPendingRequest { id: string; clientId: string; clientName: string; redirectHost: string; requestedScopes: McpScope[]; defaultScopes: McpScope[]; expiresAt: string }
export interface OAuthClientInfo { id: string; name: string; redirectUris: string[]; source: 'dcr' | 'manual'; confidential: boolean; createdAt: string; activeGrants: number }
export interface OAuthGrantInfo { id: string; clientId: string; clientName: string; scopes: McpScope[]; createdAt: string; lastUsedAt: string | null }
export interface McpConnectionInfo { endpoint: string; issuer: string; resourceMetadata: string; authorizationServerMetadata: string; scopes: McpScope[] }
export interface OidcStatus { name: string }
export interface OidcIdentityInfo { configured: boolean; name: string | null; configError: string | null; redirectUri: string | null; identity: { issuer: string; email: string | null; linkedAt: string; lastLoginAt: string | null } | null }
export interface ApiKeyInfo { id: string; name: string; prefix: string; scopes: ApiScope[]; expiresAt: string | null; createdAt: string; lastUsedAt: string | null }
export interface ApiKeyCreated extends ApiKeyInfo { key: string }
export interface BillPage { items: Bill[]; total: number; page: number; pageSize: number }
export interface CurrencySummary { currency: Currency; pendingTotalMinor: number; nextDueDate: string | null; byDate: {dueDate: string; amountMinor: number; billCount: number}[] }
export interface FundingSummary { dueMonth: string; accounts: {accountId: string; accountName: string; byCurrency: CurrencySummary[]}[]; historicalPending: Bill[] }
export interface Review { id: string; cardId: string; cardName: string; frequency: 'regular' | 'low'; status: 'unreviewed' | 'no_new' | 'reviewed'; version: number; confirmedAt: string | null; billIds: string[] }

export function parseMoney(value: string, currency: Currency): number {
  const digits = currencies[currency];
  if (digits === undefined || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('请输入正数金额');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) throw new Error(`${currency} 最多支持 ${digits} 位小数`);
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (minor <= 0n) throw new Error('零金额请使用“无新增账单”，不创建账单');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('金额超出安全范围');
  return Number(minor);
}
export function addMinor(a: number, b: number): number {
  const total = BigInt(a) + BigInt(b);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('汇总金额超出安全范围');
  return Number(total);
}
export function moneyDecimal(amountMinor: number, currency: Currency): string {
  const digits = currencies[currency];
  const value = String(amountMinor).padStart(digits + 1, '0');
  return digits ? `${value.slice(0, -digits)}.${value.slice(-digits)}` : value;
}
export function formatMoney(amountMinor: number, currency: Currency): string {
  const [whole, fraction] = moneyDecimal(amountMinor, currency).split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}`;
}
export function japanToday(now = new Date()): string { return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now); }
// date-only 加减自然日，按 UTC 计算以避开本地时区与夏令时。
export function addDays(date: string, days: number): string { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function japanMonth(): string { return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit'}).format(new Date()); }

export interface NotificationItem {
  id: string; version: number; kind: 'upcoming' | 'overdue' | 'test'; accountId: string | null; accountName: string;
  dueDate: string | null; currency: Currency | null; amountMinor: number | null; billCount: number;
  createdAt: string; updatedAt: string; readAt: string | null; resolvedAt: string | null;
}
export interface NotificationPage { items: NotificationItem[]; total: number; unreadCount: number; page: number; pageSize: number }
