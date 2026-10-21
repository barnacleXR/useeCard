import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { billStatusSchema, currencySchema, dateSchema, monthSchema, type Bill, type BillInput, type McpScope } from '@ccm/shared';
import { z, ZodError } from 'zod';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import { LedgerService } from '../common/ledger.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';

const INSTRUCTIONS = [
  'useeCard 是自托管的日本信用卡备款工具：用户手动录入银行账单的金额、币种与实际扣款日，按扣款账户与币种汇总需要准备的资金。',
  '金额一律为最小货币单位整数（JPY 无小数，USD 等以分计），必须同时给出币种；不同币种不能相加，也不做汇率换算。',
  '实际扣款日以用户提供的为准，不要推算或替用户补默认日期。月度检查的“无新增”只表示该卡本轮没有新账单，不会抵消已录入的待还账单。',
  '写入工具需要相应授权；更新、确认扣款、作废都要带最新的 version，冲突时请重新读取后再试。',
].join('\n');

const READ: ToolAnnotations = {readOnlyHint: true, idempotentHint: true, openWorldHint: false};
const WRITE: ToolAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const ok = (value: unknown): CallToolResult => ({content: [{type: 'text', text: JSON.stringify(value, null, 2)}]});
const fail = (error: string, message: string, extra: Record<string, unknown> = {}): CallToolResult => ({isError: true, content: [{type: 'text', text: JSON.stringify({error, message, ...extra}, null, 2)}]});
const uuid = z.string().uuid();
const requestId = uuid.describe('本次请求的唯一 ID（UUID）；重试同一请求时保持不变');
const version = z.number().int().positive().describe('账单或检查项当前的 version，用于防止覆盖他人修改');

/**
 * MCP 资源端（Streamable HTTP，无状态）。每个请求按令牌权限注册工具；
 * 工具执行时再次检查权限，写入全部调用与 Web、App 相同的领域服务。
 */
@Injectable()
export class McpService {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService, @Inject(BillsService) private readonly bills: BillsService,
              @Inject(ReportsService) private readonly reports: ReportsService, @Inject(ReviewsService) private readonly reviews: ReviewsService,
              @Inject(LedgerService) private readonly ledger: LedgerService) {}

  async handle(req: Request, res: Response) {
    const auth = req.auth!;
    const server = this.build(String(auth.extra?.userId), new Set(auth.scopes as McpScope[]));
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** 构建只含当前令牌可用工具的服务器实例；导出供测试直接调用。 */
  build(owner: string, scopes: Set<McpScope>): McpServer {
    const server = new McpServer({name: 'useecard', title: 'useeCard 信用卡备款', version: '2.0.0'}, {instructions: INSTRUCTIONS});
    const tool = <S extends z.ZodRawShape>(name: string, scope: McpScope, config: {title: string; description: string; inputSchema: S; annotations: ToolAnnotations}, run: (args: z.infer<z.ZodObject<S>>) => unknown) => {
      if (!scopes.has(scope)) return; // 未授权的工具不注册
      server.registerTool(name, config, (async (args: z.infer<z.ZodObject<S>>) => {
        // 注解不是安全边界：执行前再次校验权限。
        if (!scopes.has(scope)) return fail('forbidden', `当前授权缺少 ${scope}`);
        try { const result = await run(args); return (result as CallToolResult)?.content ? result as CallToolResult : ok(result); }
        catch (error) { return this.toError(error); }
      }) as never);
    };

    tool('list_accounts', 'accounts:read', {title: '列出扣款账户', description: '列出银行扣款账户。默认不含已归档账户。', annotations: READ,
      inputSchema: {includeArchived: z.boolean().optional().describe('是否包含已归档账户')}},
      ({includeArchived}) => ({accounts: this.accounts.accounts(owner).filter(a => includeArchived || !a.archivedAt).map(a => ({id: a.id, name: a.name, bankName: a.bankName, bankCode: a.bankCode, archived: !!a.archivedAt}))}));

    tool('list_cards', 'cards:read', {title: '列出信用卡', description: '列出信用卡及其默认扣款账户与默认币种。默认不含已归档卡片。', annotations: READ,
      inputSchema: {includeArchived: z.boolean().optional()}},
      ({includeArchived}) => ({cards: this.accounts.cards(owner).filter(c => includeArchived || !c.archivedAt).map(c => ({id: c.id, name: c.name, issuer: c.issuer, last4: c.last4, brand: c.brand,
        defaultDebitAccountId: c.defaultDebitAccountId, defaultCurrency: c.defaultCurrency, frequency: c.frequency, archived: !!c.archivedAt}))}));

    tool('list_bills', 'bills:read', {title: '查询账单', description: '按实际扣款月份、币种、状态或卡片查询账单，按扣款日排序，最多返回 200 笔。', annotations: READ,
      inputSchema: {dueMonth: monthSchema.optional().describe('实际扣款月份 YYYY-MM'), currency: currencySchema.optional(), status: billStatusSchema.optional(), cardId: uuid.optional()}},
      (filter) => { const all = this.bills.bills(owner, filter); return {bills: all.slice(0, 200).map(this.bill), total: all.length, truncated: all.length > 200}; });

    tool('get_bill', 'bills:read', {title: '读取账单', description: '按 ID 读取单笔账单（含当前 version）。', annotations: READ, inputSchema: {billId: uuid}},
      ({billId}) => this.bill(this.bills.bill(owner, billId)));

    tool('get_funding_summary', 'summary:read', {title: '备款汇总', description: '某个实际扣款月份按扣款账户、币种、日期汇总的待扣款金额；各币种分别列出，不跨币种相加。另附之前月份仍待确认的账单。', annotations: READ,
      inputSchema: {dueMonth: monthSchema.describe('实际扣款月份 YYYY-MM'), currency: currencySchema.optional()}},
      ({dueMonth, currency}) => { const s = this.reports.summary(owner, dueMonth, currency); return {...s, historicalPending: s.historicalPending.map(this.bill)}; });

    tool('get_monthly_review', 'reviews:read', {title: '月度检查状态', description: '读取某个检查月份的逐卡检查状态（unreviewed / no_new / reviewed）及已关联账单。清单尚未创建时返回空列表。', annotations: READ,
      inputSchema: {reviewMonth: monthSchema}},
      ({reviewMonth}) => ({reviewMonth, items: this.reviews.reviews(owner, reviewMonth).map(r => ({id: r.id, cardId: r.cardId, cardName: r.cardName, frequency: r.frequency, status: r.status, version: r.version, billIds: r.billIds}))}));

    tool('create_bill', 'bills:write', {title: '录入账单', description: '录入一笔银行账单。金额（最小货币单位整数）、币种与实际扣款日都必须由用户提供，不要猜测。卡片可用 cardId 或 cardName 指定；cardName 匹配多张卡时返回候选，请让用户选择。扣款账户默认取卡片的默认账户。同一 requestId 重试不会重复录入。',
      annotations: {...WRITE, idempotentHint: true},
      inputSchema: {cardId: uuid.optional(), cardName: z.string().trim().min(1).max(100).optional().describe('卡片名称（未提供 cardId 时使用）'),
        amountMinor: z.number().int().positive().describe('最小货币单位整数，例如 JPY 12000、USD 12.34 → 1234'), currency: currencySchema.describe('账单币种，必须明确提供'),
        dueDate: dateSchema.describe('实际扣款日 YYYY-MM-DD，以银行显示为准'), debitAccountId: uuid.optional(), statementMonth: monthSchema.optional(), note: z.string().max(1000).optional(), requestId}},
      (args) => {
        const card = this.resolveCard(owner, args.cardId, args.cardName);
        if ('error' in card) return card.error;
        const input: BillInput = {cardId: card.id, debitAccountId: args.debitAccountId ?? card.defaultDebitAccountId, amountMinor: args.amountMinor, currency: args.currency,
          dueDate: args.dueDate, statementMonth: args.statementMonth ?? null, note: args.note ?? ''};
        return this.bill(this.bills.createBill(owner, input, args.requestId));
      });

    tool('update_bill', 'bills:write', {title: '修改账单', description: '修改账单的金额、币种、实际扣款日、扣款账户、卡片或备注；未提供的字段保持不变。修改币种需同时传 confirmCurrencyChange=true，系统不会换算金额。',
      annotations: {...WRITE, idempotentHint: true},
      inputSchema: {billId: uuid, version, requestId: requestId.optional(), amountMinor: z.number().int().positive().optional(), currency: currencySchema.optional(), dueDate: dateSchema.optional(),
        debitAccountId: uuid.optional(), cardId: uuid.optional(), statementMonth: monthSchema.nullable().optional(), note: z.string().max(1000).optional(), confirmCurrencyChange: z.boolean().optional()}},
      (args) => {
        const current = this.bills.bill(owner, args.billId);
        return this.bill(this.bills.updateBill(owner, args.billId, {cardId: args.cardId ?? current.cardId, debitAccountId: args.debitAccountId ?? current.debitAccountId,
          amountMinor: args.amountMinor ?? current.amountMinor, currency: args.currency ?? current.currency, dueDate: args.dueDate ?? current.dueDate,
          statementMonth: args.statementMonth === undefined ? current.statementMonth : args.statementMonth, note: args.note ?? current.note, version: args.version,
          ...(args.confirmCurrencyChange ? {confirmCurrencyChange: true} : {})}));
      });

    const transition = (name: string, action: 'paid' | 'undo-paid' | 'void', title: string, description: string, annotations: ToolAnnotations) =>
      tool(name, 'bills:write', {title, description, annotations, inputSchema: {billId: uuid, version, requestId: requestId.optional()}},
        ({billId, version}) => this.bill(this.bills.transition(owner, billId, action, {version})));
    transition('mark_bill_paid', 'paid', '确认已扣款', '将待扣款账单标记为已扣款（用户确认银行已扣款后再调用）。', WRITE);
    transition('undo_bill_paid', 'undo-paid', '撤销已扣款', '把已扣款账单恢复为待扣款。', WRITE);
    transition('void_bill', 'void', '作废账单', '作废账单：保留历史记录，但从备款汇总与提醒中排除，且解除其与月度检查的关联。此操作不可通过工具恢复。', {...WRITE, destructiveHint: true});

    tool('confirm_no_new_bill', 'reviews:write', {title: '标记无新增账单', description: '在指定检查月份，为明确列出的卡片标记“本月无新增账单”。不会生成零元账单，也不会抵消已录入的账单。若该卡本轮已关联账单，需要传 unlinkConfirmed=true 才会解除关联。',
      annotations: {...WRITE, idempotentHint: true},
      inputSchema: {reviewMonth: monthSchema, cardIds: z.array(uuid).min(1).max(100), requestId, unlinkConfirmed: z.boolean().optional()}},
      ({reviewMonth, cardIds, unlinkConfirmed}) => {
        const items = this.reviews.reviews(owner, reviewMonth);
        if (!items.length) return fail('review_not_started', `${reviewMonth} 的检查清单尚未创建，请先在 useeCard 中创建清单`);
        const missing = cardIds.filter(id => !items.some(r => r.cardId === id));
        if (missing.length) return fail('card_not_in_review', '部分卡片不在本轮检查清单中', {cardIds: missing});
        const chosen = items.filter(r => cardIds.includes(r.cardId));
        const linked = chosen.filter(r => r.billIds.length);
        if (linked.length && !unlinkConfirmed) return fail('linked_bills', '这些卡本轮已关联账单；确认要解除关联时请传 unlinkConfirmed=true（账单本身保留）', {cards: linked.map(r => ({cardId: r.cardId, cardName: r.cardName, billIds: r.billIds}))});
        const result = this.reviews.confirmReview(owner, reviewMonth, {items: chosen.map(r => ({id: r.id, version: r.version, status: 'no_new', unlinkConfirmed: !!unlinkConfirmed}))});
        return {reviewMonth, items: result.filter(r => cardIds.includes(r.cardId)).map(r => ({id: r.id, cardName: r.cardName, status: r.status, version: r.version}))};
      });

    tool('confirm_reviewed_bills', 'reviews:write', {title: '确认已核对账单', description: '把明确列出的账单关联到某张卡的本轮检查项，并将其标记为“已核对”。账单必须属于该卡且未作废，可以是其他月份录入的账单。',
      annotations: {...WRITE, idempotentHint: true},
      inputSchema: {reviewId: uuid, billIds: z.array(uuid).min(1).max(100), version}},
      ({reviewId, billIds, version}) => {
        const period = this.ledger.db.prepare('SELECT p.reviewMonth FROM card_reviews r JOIN review_periods p ON p.id=r.periodId WHERE r.id=? AND p.ownerId=?').get(reviewId, owner) as {reviewMonth: string} | undefined;
        if (!period) return fail('not_found', '检查项不存在');
        const result = this.reviews.confirmReview(owner, period.reviewMonth, {items: [{id: reviewId, version, status: 'reviewed', billIds}]});
        const item = result.find(r => r.id === reviewId)!;
        return {reviewMonth: period.reviewMonth, id: item.id, cardName: item.cardName, status: item.status, version: item.version, billIds: item.billIds};
      });

    return server;
  }

  private bill = (b: Bill) => ({id: b.id, cardId: b.cardId, cardName: b.cardName, debitAccountId: b.debitAccountId, accountName: b.accountName, amountMinor: b.amountMinor,
    currency: b.currency, dueDate: b.dueDate, statementMonth: b.statementMonth, status: b.status, paidAt: b.paidAt, note: b.note, version: b.version});

  /** 按 ID 或名称定位卡片；名称匹配多张时返回候选，不擅自选择。 */
  private resolveCard(owner: string, cardId?: string, cardName?: string): {id: string; defaultDebitAccountId: string} | {error: CallToolResult} {
    const cards = this.accounts.cards(owner).filter(c => !c.archivedAt);
    if (cardId) { const card = cards.find(c => c.id === cardId); return card ?? {error: fail('card_not_found', '卡片不存在或已归档', {cardId})}; }
    if (!cardName) return {error: fail('missing_fields', '请提供 cardId 或 cardName', {missing: ['cardId']})};
    const query = cardName.normalize('NFKC').toLowerCase();
    const exact = cards.filter(c => c.name.normalize('NFKC').toLowerCase() === query);
    const matches = exact.length ? exact : cards.filter(c => c.name.normalize('NFKC').toLowerCase().includes(query));
    if (matches.length === 1) return matches[0];
    if (!matches.length) return {error: fail('card_not_found', `没有找到名为「${cardName}」的卡片`, {candidates: cards.map(c => ({id: c.id, name: c.name, last4: c.last4}))})};
    return {error: fail('ambiguous_card', `「${cardName}」匹配到多张卡片，请让用户选择后用 cardId 重试`, {candidates: matches.map(c => ({id: c.id, name: c.name, last4: c.last4}))})};
  }

  private toError(error: unknown): CallToolResult {
    if (error instanceof ZodError) return fail('invalid_input', error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；'));
    if (error instanceof HttpException) {
      const status = error.getStatus();
      return fail(status === 409 ? 'conflict' : status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'invalid_request', error.message);
    }
    return fail('server_error', '服务暂时无法完成请求');
  }
}

