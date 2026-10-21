import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { monthSchema, type Review } from '@ccm/shared';
import { z } from 'zod';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import { LedgerService } from '../common/ledger.service.js';

const confirmInput = z.object({items: z.array(z.object({id: z.string().uuid(), version: z.number().int().positive(), status: z.enum(['no_new', 'reviewed', 'unreviewed']), billIds: z.array(z.string().uuid()).default([]), unlinkConfirmed: z.boolean().default(false)}).strict()).min(1).max(200)}).strict();

// 月度检查：独立于账单；未检查不推断为零，无新增不抵消账单。
@Injectable()
export class ReviewsService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService, @Inject(BillsService) private readonly bills: BillsService, @Inject(AccountsService) private readonly accounts: AccountsService) {}
  private get db() { return this.ledger.db; }
  private period(owner: string, month: string) { return this.db.prepare('SELECT id FROM review_periods WHERE ownerId=? AND reviewMonth=?').get(owner, month) as {id: string} | undefined; }
  reviews(owner: string, month: string): Review[] {
    monthSchema.parse(month);
    const period = this.period(owner, month);
    if (!period) return [];
    const rows = this.db.prepare('SELECT r.*,c.name AS cardName,c.frequency FROM card_reviews r JOIN credit_cards c ON c.id=r.cardId WHERE periodId=? ORDER BY c.sortOrder,c.rowid').all(period.id) as (Omit<Review, 'billIds'>)[];
    return rows.map(row => ({...row, billIds: (this.db.prepare('SELECT billId FROM review_bill_links WHERE reviewId=?').all(row.id) as {billId: string}[]).map(b => b.billId)}));
  }
  startReview(owner: string, month: string) {
    monthSchema.parse(month);
    return this.db.transaction(() => {
      if (!this.period(owner, month)) {
        const id = randomUUID(); this.db.prepare('INSERT INTO review_periods VALUES(?,?,?)').run(id, owner, month);
        for (const card of this.accounts.cards(owner)) if (!card.archivedAt) this.db.prepare('INSERT INTO card_reviews(id,periodId,cardId) VALUES(?,?,?)').run(randomUUID(), id, card.id);
        this.ledger.audit(owner, 'review.start', id, {month});
      }
      return this.reviews(owner, month);
    })();
  }
  // 清单创建后新增的卡片，只在用户明确选择时加入，不重写清单。
  addReviewCards(owner: string, month: string, body: unknown) {
    monthSchema.parse(month);
    const {cardIds} = z.object({cardIds: z.array(z.string().uuid()).min(1).max(200)}).strict().parse(body);
    return this.db.transaction(() => {
      const period = this.period(owner, month);
      if (!period) throw new NotFoundException('该月份尚未创建检查清单');
      for (const cardId of new Set(cardIds)) {
        this.ledger.owned('credit_cards', owner, cardId, true);
        if (this.db.prepare('SELECT 1 FROM card_reviews WHERE periodId=? AND cardId=?').get(period.id, cardId)) throw new ConflictException('卡片已在本轮清单中');
        this.db.prepare('INSERT INTO card_reviews(id,periodId,cardId) VALUES(?,?,?)').run(randomUUID(), period.id, cardId);
      }
      this.ledger.audit(owner, 'review.add-cards', period.id, {month, cardIds}); return this.reviews(owner, month);
    })();
  }
  confirmReview(owner: string, month: string, body: unknown) {
    const input = confirmInput.parse(body);
    return this.db.transaction(() => {
      const reviews = this.reviews(owner, month);
      for (const item of input.items) {
        const row = reviews.find(r => r.id === item.id);
        if (!row) throw new NotFoundException('检查项不存在');
        if (row.version !== item.version) throw new ConflictException('检查项已更新，请刷新');
        if (item.status !== 'reviewed' && item.billIds.length) throw new BadRequestException('无新增或未确认状态不能关联账单');
        if (item.status === 'reviewed' && !item.billIds.length) throw new BadRequestException('请选择已核对的账单');
        if (row.billIds.length && item.status !== 'reviewed' && !item.unlinkConfirmed) throw new BadRequestException('请明确确认解除已有账单关联');
        for (const id of item.billIds) { const bill = this.bills.bill(owner, id); if (bill.cardId !== row.cardId || bill.status === 'void') throw new BadRequestException('只能关联当前卡片的有效账单'); }
        this.db.prepare('DELETE FROM review_bill_links WHERE reviewId=?').run(row.id);
        for (const id of new Set(item.billIds)) this.db.prepare('INSERT INTO review_bill_links VALUES(?,?)').run(row.id, id);
        this.db.prepare('UPDATE card_reviews SET status=?,confirmedAt=?,version=version+1 WHERE id=? AND version=?').run(item.status, item.status === 'unreviewed' ? null : new Date().toISOString(), row.id, item.version);
        this.ledger.audit(owner, 'review.confirm', row.id, item);
      }
      return this.reviews(owner, month);
    })();
  }
}
