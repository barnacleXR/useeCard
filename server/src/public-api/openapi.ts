import { apiScopes, currencies } from '@ccm/shared';

// 只读 REST API v1 的 OpenAPI 3.1 描述；与 public-api.controller.ts 的对外字段保持一致。
const money = {amountMinor: {type: 'integer', description: '最小货币单位的整数（JPY 无小数，USD 等为分）'}, currency: {type: 'string', enum: Object.keys(currencies)}};
const date = {type: 'string', format: 'date', description: '实际扣款日（日本日期，YYYY-MM-DD）'};
const month = {type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-11'};
const ref = (name: string) => ({$ref: `#/components/schemas/${name}`});
const list = (name: string) => ({type: 'object', required: ['items'], properties: {items: {type: 'array', items: ref(name)}}});
const ok = (schema: object) => ({description: '成功', content: {'application/json': {schema}}});
const errors = {
  '400': {description: '参数校验失败', content: {'application/json': {schema: ref('Error')}}},
  '401': {description: 'API Key 缺失、无效、已撤销或已过期', content: {'application/json': {schema: ref('Error')}}},
  '403': {description: 'API Key 缺少所需 scope', content: {'application/json': {schema: ref('Error')}}},
  '429': {description: '超过每分钟请求上限', headers: {'Retry-After': {schema: {type: 'integer'}, description: '需等待的秒数'}}, content: {'application/json': {schema: ref('Error')}}},
};
const op = (summary: string, scope: string, schema: object, parameters: object[] = []) => ({summary, security: [{apiKey: [scope]}], parameters, responses: {'200': ok(schema), ...errors}});
const query = (name: string, schema: object, description?: string, required = false) => ({name, in: 'query', required, schema, ...(description ? {description} : {})});

export const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'useeCard 只读 API', version: '1.0.0',
    description: '自托管信用卡备款管理的只读接口。使用 `Authorization: Bearer <API Key>`；不接受 Web 登录 Cookie、App 设备令牌或 MCP 令牌。金额一律为最小货币单位整数并携带币种，各币种分别汇总，不跨币种相加。',
  },
  servers: [{url: '/'}],
  components: {
    securitySchemes: {apiKey: {type: 'http', scheme: 'bearer', bearerFormat: 'ccmk_…', description: `在 Web「设置 → 外部 API」创建。可用 scope：${apiScopes.join('、')}`}},
    schemas: {
      Error: {type: 'object', required: ['message'], properties: {message: {type: 'string'}}},
      Account: {type: 'object', required: ['id', 'name', 'bankName', 'bankCode'], properties: {id: {type: 'string', format: 'uuid'}, name: {type: 'string'}, bankName: {type: 'string'}, bankCode: {type: 'string', description: '全国银行协会金融机构代码，可为空'}, archivedAt: {type: ['string', 'null'], format: 'date-time'}}},
      Card: {type: 'object', required: ['id', 'name', 'defaultDebitAccountId', 'defaultCurrency', 'frequency'], properties: {id: {type: 'string', format: 'uuid'}, name: {type: 'string'}, issuer: {type: 'string'}, last4: {type: 'string'}, brand: {type: 'string'}, defaultDebitAccountId: {type: 'string', format: 'uuid'}, defaultCurrency: money.currency, frequency: {type: 'string', enum: ['regular', 'low']}, archivedAt: {type: ['string', 'null'], format: 'date-time'}}},
      Bill: {type: 'object', required: ['id', 'cardId', 'debitAccountId', 'amountMinor', 'currency', 'dueDate', 'status', 'version'], properties: {id: {type: 'string', format: 'uuid'}, cardId: {type: 'string', format: 'uuid'}, debitAccountId: {type: 'string', format: 'uuid'}, ...money, dueDate: date, statementMonth: {type: ['string', 'null']}, status: {type: 'string', enum: ['pending', 'paid', 'void']}, paidAt: {type: ['string', 'null'], format: 'date-time'}, note: {type: 'string'}, version: {type: 'integer'}, createdAt: {type: 'string', format: 'date-time'}, updatedAt: {type: 'string', format: 'date-time'}}},
      BillPage: {type: 'object', required: ['items', 'nextCursor'], properties: {items: {type: 'array', items: ref('Bill')}, nextCursor: {type: ['string', 'null'], description: '传给下一次请求的 cursor；为 null 表示没有更多'}}},
      CurrencySummary: {type: 'object', required: ['currency', 'pendingTotalMinor', 'byDate'], properties: {currency: money.currency, pendingTotalMinor: {type: 'integer'}, nextDueDate: {type: ['string', 'null'], format: 'date'}, byDate: {type: 'array', items: {type: 'object', properties: {dueDate: date, amountMinor: {type: 'integer'}, billCount: {type: 'integer'}}}}}},
      Summary: {type: 'object', required: ['dueMonth', 'accounts', 'historicalPending'], description: '每个账户按币种分组；不存在顶层或跨币种总额。', properties: {dueMonth: month, accounts: {type: 'array', items: {type: 'object', properties: {accountId: {type: 'string', format: 'uuid'}, accountName: {type: 'string'}, byCurrency: {type: 'array', items: ref('CurrencySummary')}}}}, historicalPending: {type: 'array', description: '所选月份之前仍待确认扣款的账单', items: ref('Bill')}}},
      Review: {type: 'object', required: ['id', 'cardId', 'status', 'billIds'], properties: {id: {type: 'string', format: 'uuid'}, cardId: {type: 'string', format: 'uuid'}, cardName: {type: 'string'}, frequency: {type: 'string', enum: ['regular', 'low']}, status: {type: 'string', enum: ['unreviewed', 'no_new', 'reviewed']}, version: {type: 'integer'}, confirmedAt: {type: ['string', 'null'], format: 'date-time'}, billIds: {type: 'array', items: {type: 'string', format: 'uuid'}}}},
    },
  },
  paths: {
    '/api/v1/accounts': {get: op('银行账户列表', 'accounts:read', list('Account'))},
    '/api/v1/cards': {get: op('信用卡列表', 'cards:read', list('Card'))},
    '/api/v1/bills': {get: op('账单查询（按扣款日、id 升序，游标分页）', 'bills:read', ref('BillPage'), [
      query('dueMonth', month, '实际扣款月份'), query('status', {type: 'string', enum: ['pending', 'paid', 'void']}), query('currency', money.currency),
      query('cardId', {type: 'string', format: 'uuid'}), query('accountId', {type: 'string', format: 'uuid'}), query('from', date, '扣款日起（含）'), query('to', date, '扣款日止（含）'),
      query('limit', {type: 'integer', minimum: 1, maximum: 100, default: 50}), query('cursor', {type: 'string'}, '上一页返回的 nextCursor'),
    ])},
    '/api/v1/bills/{id}': {get: {...op('单笔账单', 'bills:read', ref('Bill')), parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string', format: 'uuid'}}], responses: {'200': ok(ref('Bill')), ...errors, '404': {description: '账单不存在', content: {'application/json': {schema: ref('Error')}}}}}},
    '/api/v1/summary': {get: op('按账户与币种的备款汇总', 'summary:read', ref('Summary'), [query('dueMonth', month, '实际扣款月份', true), query('currency', money.currency, '只看某一币种')])},
    '/api/v1/reviews': {get: op('月度检查状态', 'reviews:read', list('Review'), [query('reviewMonth', month, '检查月份', true)])},
  },
} as const;
