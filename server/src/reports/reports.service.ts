import { Inject, Injectable } from '@nestjs/common';
import { addMinor, currencySchema, monthSchema, type Bill, type Currency, type FundingSummary } from '@ccm/shared';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';

// 备款汇总、日历与月报：只读聚合，按币种分组，绝不跨币种求和。
@Injectable()
export class ReportsService {
  constructor(@Inject(BillsService) private readonly bills: BillsService, @Inject(AccountsService) private readonly accounts: AccountsService) {}
  summary(owner: string, dueMonth: string, currency?: string): FundingSummary {
    monthSchema.parse(dueMonth); if (currency) currencySchema.parse(currency);
    const all = this.bills.bills(owner, {status: 'pending', ...(currency ? {currency} : {})});
    const groups = new Map<string, FundingSummary['accounts'][number]>();
    for (const bill of all.filter(b => b.dueDate.slice(0, 7) === dueMonth)) {
      let account = groups.get(bill.debitAccountId);
      if (!account) { account = {accountId: bill.debitAccountId, accountName: bill.accountName, byCurrency: []}; groups.set(bill.debitAccountId, account); }
      let group = account.byCurrency.find(g => g.currency === bill.currency);
      if (!group) { group = {currency: bill.currency, pendingTotalMinor: 0, nextDueDate: bill.dueDate, byDate: []}; account.byCurrency.push(group); }
      group.pendingTotalMinor = addMinor(group.pendingTotalMinor, bill.amountMinor);
      const date = group.byDate.find(d => d.dueDate === bill.dueDate);
      if (date) { date.amountMinor = addMinor(date.amountMinor, bill.amountMinor); date.billCount++; }
      else group.byDate.push({dueDate: bill.dueDate, amountMinor: bill.amountMinor, billCount: 1});
    }
    // 账户卡片按用户设定的显示顺序排列。
    const order = new Map(this.accounts.accounts(owner).map((a, index) => [a.id, index]));
    const accounts = [...groups.values()].sort((a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0));
    return {dueMonth, accounts, historicalPending: all.filter(b => b.dueDate.slice(0, 7) < dueMonth)};
  }
  calendar(owner: string, dueMonth: string, currency?: string): Bill[] {
    monthSchema.parse(dueMonth);
    return this.bills.bills(owner, {dueMonth, currency}).filter(b => b.status !== 'void');
  }
  monthlyReport(owner: string, month: string, currency?: string) {
    const bills = this.bills.bills(owner, {dueMonth: month, ...(currency ? {currency} : {})}).filter(b => b.status !== 'void');
    const byCurrency: {currency: Currency; pendingMinor: number; paidMinor: number; totalMinor: number; billCount: number}[] = [];
    for (const bill of bills) {
      let group = byCurrency.find(g => g.currency === bill.currency);
      if (!group) { group = {currency: bill.currency, pendingMinor: 0, paidMinor: 0, totalMinor: 0, billCount: 0}; byCurrency.push(group); }
      const field = bill.status === 'paid' ? 'paidMinor' : 'pendingMinor';
      group[field] = addMinor(group[field], bill.amountMinor); group.totalMinor = addMinor(group.totalMinor, bill.amountMinor); group.billCount++;
    }
    return {dueMonth: month, byCurrency, bills};
  }
}
