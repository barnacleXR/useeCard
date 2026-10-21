import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { billInput, billSearchInput, billStatusSchema, currencySchema, monthSchema, versionInput, type Bill, type BillPage } from '@ccm/shared';
import { z } from 'zod';
import { LedgerService } from '../common/ledger.service.js';

export interface BillFilter { dueMonth?: string; currency?: string; status?: string; cardId?: string; accountId?: string; from?: string; to?: string }
const SELECT = 'SELECT b.*, c.name AS cardName, a.name AS accountName FROM bills b JOIN credit_cards c ON c.id=b.cardId JOIN bank_accounts a ON a.id=b.debitAccountId';

// 账单录入、编辑与状态流转。
@Injectable()
export class BillsService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}
  private get db() { return this.ledger.db; }
  // 只拼接固定条件片段，取值全部走命名参数。
  private where(owner: string, filter: BillFilter) {
    const clauses = ['b.ownerId=@owner']; const params: Record<string, string> = {owner};
    const add = (key: keyof BillFilter, clause: string) => { const value = filter[key]; if (value) { clauses.push(clause); params[key] = value; } };
    add('dueMonth', 'substr(b.dueDate,1,7)=@dueMonth'); add('currency', 'b.currency=@currency'); add('status', 'b.status=@status');
    add('cardId', 'b.cardId=@cardId'); add('accountId', 'b.debitAccountId=@accountId'); add('from', 'b.dueDate>=@from'); add('to', 'b.dueDate<=@to');
    return {sql: clauses.join(' AND '), params};
  }
  bills(owner: string, query: BillFilter = {}): Bill[] {
    if (query.cardId) z.string().uuid().parse(query.cardId);
    if (query.dueMonth) monthSchema.parse(query.dueMonth);
    if (query.currency) currencySchema.parse(query.currency);
    if (query.status) billStatusSchema.parse(query.status);
    const {sql, params} = this.where(owner, query);
    return this.db.prepare(`${SELECT} WHERE ${sql} ORDER BY b.dueDate,b.createdAt`).all(params) as Bill[];
  }
  // 账单页：多条件筛选，扣款日倒序分页。
  search(owner: string, query: unknown): BillPage {
    const {page, pageSize, ...filter} = billSearchInput.parse(query);
    const {sql, params} = this.where(owner, filter);
    const total = (this.db.prepare(`SELECT count(*) AS n FROM bills b WHERE ${sql}`).get(params) as {n: number}).n;
    const items = this.db.prepare(`${SELECT} WHERE ${sql} ORDER BY b.dueDate DESC,b.createdAt DESC LIMIT @limit OFFSET @offset`).all({...params, limit: pageSize, offset: (page - 1) * pageSize}) as Bill[];
    return {items, total, page, pageSize};
  }
  bill(owner: string, id: string): Bill {
    this.ledger.owned('bills', owner, id);
    return this.db.prepare(`${SELECT} WHERE b.id=? AND b.ownerId=?`).get(id, owner) as Bill;
  }
  createBill(owner: string, body: unknown, key: string) {
    z.string().uuid().parse(key); const input = billInput.parse(body); const payload = JSON.stringify(input);
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM idempotency WHERE ownerId=? AND requestKey=?').get(owner, key) as {payload: string; response: string} | undefined;
      if (prior) { if (prior.payload !== payload) throw new ConflictException('相同请求标识不能用于不同内容'); return JSON.parse(prior.response) as Bill; }
      this.ledger.owned('credit_cards', owner, input.cardId, true); this.ledger.owned('bank_accounts', owner, input.debitAccountId, true);
      const id = randomUUID(); const now = new Date().toISOString();
      this.db.prepare('INSERT INTO bills(id,ownerId,cardId,debitAccountId,amountMinor,currency,dueDate,statementMonth,note,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, input.cardId, input.debitAccountId, input.amountMinor, input.currency, input.dueDate, input.statementMonth, input.note, now, now);
      this.ledger.audit(owner, 'bill.create', id, input); const result = this.bill(owner, id);
      this.db.prepare('INSERT INTO idempotency VALUES(?,?,?,?)').run(owner, key, payload, JSON.stringify(result)); return result;
    })();
  }
  updateBill(owner: string, id: string, body: unknown) {
    const input = billInput.extend({...versionInput.shape, confirmCurrencyChange: z.boolean().optional()}).parse(body);
    return this.db.transaction(() => {
      const before = this.bill(owner, id);
      if (before.status === 'void') throw new ConflictException('作废账单不能编辑');
      if (before.currency !== input.currency && !input.confirmCurrencyChange) throw new BadRequestException('修改币种必须重新确认金额');
      this.ledger.owned('credit_cards', owner, input.cardId, input.cardId !== before.cardId); this.ledger.owned('bank_accounts', owner, input.debitAccountId, input.debitAccountId !== before.debitAccountId);
      const result = this.db.prepare('UPDATE bills SET cardId=?,debitAccountId=?,amountMinor=?,currency=?,dueDate=?,statementMonth=?,note=?,updatedAt=?,version=version+1 WHERE id=? AND ownerId=? AND version=?').run(input.cardId, input.debitAccountId, input.amountMinor, input.currency, input.dueDate, input.statementMonth, input.note, new Date().toISOString(), id, owner, input.version);
      if (!result.changes) throw new ConflictException('记录已更新，请刷新后重新编辑');
      this.ledger.audit(owner, 'bill.update', id, {before, after: input}); return this.bill(owner, id);
    })();
  }
  transition(owner: string, id: string, action: string, body: unknown) {
    const {version} = versionInput.strict().parse(body);
    z.enum(['paid', 'undo-paid', 'void']).parse(action);
    return this.db.transaction(() => {
      const before = this.bill(owner, id);
      if (before.version !== version) throw new ConflictException('记录已更新，请刷新');
      if (before.status === 'void' || (action === 'paid' && before.status !== 'pending') || (action === 'undo-paid' && before.status !== 'paid')) throw new ConflictException('当前状态不允许此操作');
      const next = action === 'paid' ? 'paid' : action === 'void' ? 'void' : 'pending';
      this.db.prepare('UPDATE bills SET status=?,paidAt=?,updatedAt=?,version=version+1 WHERE id=? AND ownerId=? AND version=?').run(next, action === 'paid' ? new Date().toISOString() : action === 'undo-paid' ? null : before.paidAt, new Date().toISOString(), id, owner, version);
      // 作废后解除检查关联；某检查项失去最后一笔关联时回到未确认。
      if (action === 'void') {
        const linked = this.db.prepare('SELECT reviewId FROM review_bill_links WHERE billId=?').all(id) as {reviewId: string}[];
        this.db.prepare('DELETE FROM review_bill_links WHERE billId=?').run(id);
        for (const {reviewId} of linked) if (!this.db.prepare('SELECT 1 FROM review_bill_links WHERE reviewId=? LIMIT 1').get(reviewId)) this.db.prepare("UPDATE card_reviews SET status='unreviewed', confirmedAt=NULL,version=version+1 WHERE id=?").run(reviewId);
      }
      this.ledger.audit(owner, `bill.${action}`, id, {before, status: next}); return this.bill(owner, id);
    })();
  }
}
