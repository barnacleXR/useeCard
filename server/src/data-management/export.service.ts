import { Inject, Injectable } from '@nestjs/common';
import { moneyDecimal } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';

// 业务导出使用明确的字段白名单，不包含密码、会话、幂等响应或部署密钥。
@Injectable()
export class ExportService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService, @Inject(AccountsService) private readonly accounts: AccountsService, @Inject(BillsService) private readonly bills: BillsService) {}
  json(owner: string) {
    return this.ledger.db.transaction(() => {
      const preferences = this.ledger.db.prepare('SELECT username,defaultCurrency,reminderDaysBefore,reminderTime FROM users WHERE id=?').get(owner);
      const periods = this.ledger.db.prepare('SELECT id,reviewMonth FROM review_periods WHERE ownerId=? ORDER BY reviewMonth').all(owner);
      const reviews = this.ledger.db.prepare('SELECT r.id,r.periodId,r.cardId,r.status,r.version,r.confirmedAt FROM card_reviews r JOIN review_periods p ON p.id=r.periodId WHERE p.ownerId=?').all(owner);
      const links = this.ledger.db.prepare('SELECT l.reviewId,l.billId FROM review_bill_links l JOIN card_reviews r ON r.id=l.reviewId JOIN review_periods p ON p.id=r.periodId WHERE p.ownerId=?').all(owner);
      const assets = (this.ledger.db.prepare('SELECT id,mime,data,source,sourceUrl,createdAt FROM assets WHERE ownerId=?').all(owner) as {data: Buffer}[]).map(({data, ...row}) => ({...row, dataBase64: data.toString('base64')}));
      const bills = this.bills.bills(owner).map(b => ({id:b.id,cardId:b.cardId,debitAccountId:b.debitAccountId,amountMinor:b.amountMinor,currency:b.currency,dueDate:b.dueDate,statementMonth:b.statementMonth,note:b.note,status:b.status,version:b.version,paidAt:b.paidAt,createdAt:b.createdAt,updatedAt:b.updatedAt,cardName:b.cardName,accountName:b.accountName}));
      return {format: 'ccm-business', version: 1, exportedAt: new Date().toISOString(), timeZone: 'Asia/Tokyo', preferences, accounts: this.accounts.accounts(owner), cards: this.accounts.cards(owner), bills, reviewPeriods: periods, reviews, reviewBillLinks: links, assets};
    })();
  }
  csv(owner: string): string {
    const headers = ['id','card','account','dueDate','statementMonth','currency','amountMinor','amount','status','paidAt','note'];
    const rows = this.bills.bills(owner).map(b => [b.id,b.cardName,b.accountName,b.dueDate,b.statementMonth ?? '',b.currency,String(b.amountMinor),moneyDecimal(b.amountMinor,b.currency),b.status,b.paidAt ?? '',b.note]);
    // 防止名称或备注被表格软件当作公式执行，所有单元格都加 CSV 引号。
    const cell = (v: string) => '"' + (/^[\s]*[=+\-@\t\r\n]/.test(v) ? "'" + v : v).replace(/"/g,'""') + '"';
    return '\uFEFF' + [headers,...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }
}
