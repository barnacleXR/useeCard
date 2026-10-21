import { Inject, Injectable } from '@nestjs/common';
import { addDays, addMinor, japanToday, type ReminderItem, type ReminderPlan } from '@ccm/shared';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import { SettingsService } from '../settings/settings.service.js';

// iOS 待发本地通知上限 64，留余量给其他用途。
export const REMINDER_LIMIT = 60;

// 按“扣款账户＋实际日期＋币种”合并已录入待还账单；原生端只排程，不重新计算金额。
@Injectable()
export class RemindersService {
  constructor(@Inject(BillsService) private readonly bills: BillsService, @Inject(SettingsService) private readonly settings: SettingsService, @Inject(AccountsService) private readonly accounts: AccountsService) {}
  plan(owner: string, today = japanToday()): ReminderPlan {
    const {reminderDaysBefore: daysBefore, reminderTime: notifyTime} = this.settings.preferences(owner);
    const groups = new Map<string, ReminderItem>();
    for (const bill of this.bills.bills(owner, {status: 'pending', from: today})) {
      const key = `${bill.debitAccountId}:${bill.dueDate}:${bill.currency}`;
      const group = groups.get(key);
      if (group) { group.amountMinor = addMinor(group.amountMinor, bill.amountMinor); group.billCount++; continue; }
      // 提醒日已过（临近扣款才录入）时改为当天提醒，不丢掉这笔备款。
      const notifyDate = [addDays(bill.dueDate, -daysBefore), today].sort().at(-1)!;
      groups.set(key, {key, accountId: bill.debitAccountId, accountName: bill.accountName, dueDate: bill.dueDate, currency: bill.currency, amountMinor: bill.amountMinor, billCount: 1, notifyDate, notifyTime});
    }
    // 同一天内按账户显示顺序、再按币种排列，与备款汇总一致。
    const order = new Map(this.accounts.accounts(owner).map((a, index) => [a.id, index]));
    const items = [...groups.values()].sort((a, b) => a.notifyDate.localeCompare(b.notifyDate) || a.dueDate.localeCompare(b.dueDate) || (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0) || a.currency.localeCompare(b.currency));
    return {generatedAt: new Date().toISOString(), today, daysBefore, notifyTime, items: items.slice(0, REMINDER_LIMIT), truncated: items.length > REMINDER_LIMIT};
  }
}
