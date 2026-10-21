import { Controller, ForbiddenException, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { billStatusSchema, currencySchema, dateSchema, monthSchema, type ApiScope, type Bill, type Review } from '@ccm/shared';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { OPENAPI_DOCUMENT } from './openapi.js';

export interface ApiKeyRequest extends AuthRequest { apiScopes?: ApiScope[] }

// 对外稳定字段：不暴露 ownerId、排序值、内部版本以外的实现细节。
const publicBill = (b: Bill) => ({id: b.id, cardId: b.cardId, debitAccountId: b.debitAccountId, amountMinor: b.amountMinor, currency: b.currency, dueDate: b.dueDate,
  statementMonth: b.statementMonth, status: b.status, paidAt: b.paidAt, note: b.note, version: b.version, createdAt: b.createdAt, updatedAt: b.updatedAt});
const publicReview = (r: Review) => ({id: r.id, cardId: r.cardId, cardName: r.cardName, frequency: r.frequency, status: r.status, version: r.version, confirmedAt: r.confirmedAt, billIds: r.billIds});

const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(value => value === '' ? undefined : value, schema.optional());
const billsQuery = z.object({
  dueMonth: optional(monthSchema), status: optional(billStatusSchema), currency: optional(currencySchema), cardId: optional(z.string().uuid()), accountId: optional(z.string().uuid()),
  from: optional(dateSchema), to: optional(dateSchema), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: optional(z.string().max(200)),
}).strict();
// 游标为不透明字符串，内容是上一页最后一笔的（扣款日, id）。
const encodeCursor = (b: {dueDate: string; id: string}) => Buffer.from(JSON.stringify([b.dueDate, b.id])).toString('base64url');
function decodeCursor(cursor: string): [string, string] {
  try { const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); if (Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'string')) return value as [string, string]; } catch { /* 落到下方报错 */ }
  throw new z.ZodError([{code: 'custom', path: ['cursor'], message: '游标无效'}]);
}

// 只读 REST API v1：仅接受 API Key（见 app.ts 中间件），各接口按 scope 授权。
@Controller('api/v1')
export class PublicApiController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService, @Inject(BillsService) private readonly bills: BillsService,
              @Inject(ReportsService) private readonly reports: ReportsService, @Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  private require(req: ApiKeyRequest, scope: ApiScope) {
    if (!req.apiScopes?.includes(scope)) throw new ForbiddenException(`此 API Key 没有 ${scope} 权限`);
  }

  @Get('openapi.json') openapi() { return OPENAPI_DOCUMENT; }

  @Get('accounts') accountList(@Req() req: ApiKeyRequest) {
    this.require(req, 'accounts:read');
    return {items: this.accounts.accounts(req.ownerId).map(a => ({id: a.id, name: a.name, bankName: a.bankName, bankCode: a.bankCode, archivedAt: a.archivedAt}))};
  }

  @Get('cards') cardList(@Req() req: ApiKeyRequest) {
    this.require(req, 'cards:read');
    return {items: this.accounts.cards(req.ownerId).map(c => ({id: c.id, name: c.name, issuer: c.issuer, last4: c.last4, brand: c.brand, defaultDebitAccountId: c.defaultDebitAccountId,
      defaultCurrency: c.defaultCurrency, frequency: c.frequency, archivedAt: c.archivedAt}))};
  }

  @Get('bills') billList(@Req() req: ApiKeyRequest, @Query() query: unknown) {
    this.require(req, 'bills:read');
    const {limit, cursor, ...filter} = billsQuery.parse(query);
    const after = cursor ? decodeCursor(cursor) : undefined;
    // 个人账本规模下按（扣款日, id）在内存中排序分页，保证游标稳定。
    const sorted = this.bills.bills(req.ownerId, filter).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    const rest = after ? sorted.filter(b => b.dueDate > after[0] || (b.dueDate === after[0] && b.id > after[1])) : sorted;
    const page = rest.slice(0, limit);
    return {items: page.map(publicBill), nextCursor: rest.length > limit ? encodeCursor(page[page.length - 1]) : null};
  }

  @Get('bills/:id') billDetail(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    this.require(req, 'bills:read');
    return publicBill(this.bills.bill(req.ownerId, z.string().uuid().parse(id)));
  }

  @Get('summary') summary(@Req() req: ApiKeyRequest, @Query('dueMonth') dueMonth: string, @Query('currency') currency?: string) {
    this.require(req, 'summary:read');
    const summary = this.reports.summary(req.ownerId, dueMonth, currency || undefined);
    return {...summary, historicalPending: summary.historicalPending.map(publicBill)};
  }

  @Get('reviews') reviewList(@Req() req: ApiKeyRequest, @Query('reviewMonth') reviewMonth: string) {
    this.require(req, 'reviews:read');
    return {items: this.reviews.reviews(req.ownerId, reviewMonth).map(publicReview)};
  }
}

