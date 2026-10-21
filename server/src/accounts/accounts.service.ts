import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { accountInput, cardInput, reorderInput, versionInput, type Account, type Card } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';

type MasterTable = 'bank_accounts' | 'credit_cards';

// 银行账户与信用卡主数据。
@Injectable()
export class AccountsService {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}
  private get db() { return this.ledger.db; }
  accounts(owner: string): Account[] { return this.db.prepare('SELECT id,name,bankName,bankCode,iconAssetId,note,sortOrder,version,archivedAt FROM bank_accounts WHERE ownerId=? ORDER BY sortOrder,rowid').all(owner) as Account[]; }
  cards(owner: string): Card[] { return this.db.prepare('SELECT id,name,issuer,last4,defaultDebitAccountId,defaultCurrency,frequency,brand,iconAssetId,note,sortOrder,version,archivedAt FROM credit_cards WHERE ownerId=? ORDER BY sortOrder,rowid').all(owner) as Card[]; }
  // 图标只能引用本人上传或抓取的图片资产。
  private ownedAsset(owner: string, assetId: string | null) {
    if (assetId && !this.db.prepare('SELECT 1 FROM assets WHERE id=? AND ownerId=?').get(assetId, owner)) throw new BadRequestException('图标不存在，请重新选择');
  }
  private nextOrder(table: MasterTable, owner: string) { return (this.db.prepare(`SELECT COALESCE(MAX(sortOrder),0)+1 AS n FROM ${table} WHERE ownerId=?`).get(owner) as {n: number}).n; }
  createAccount(owner: string, body: unknown) {
    const input = accountInput.parse(body); const id = randomUUID(); this.ownedAsset(owner, input.iconAssetId);
    return this.db.transaction(() => {
      this.db.prepare('INSERT INTO bank_accounts(id,ownerId,name,bankName,bankCode,iconAssetId,note,sortOrder) VALUES(?,?,?,?,?,?,?,?)').run(id, owner, input.name, input.bankName, input.bankCode, input.iconAssetId, input.note, this.nextOrder('bank_accounts', owner));
      this.ledger.audit(owner, 'account.create', id, input); return this.ledger.owned('bank_accounts', owner, id);
    })();
  }
  createCard(owner: string, body: unknown) {
    const input = cardInput.parse(body); this.ledger.owned('bank_accounts', owner, input.defaultDebitAccountId, true); this.ownedAsset(owner, input.iconAssetId); const id = randomUUID();
    return this.db.transaction(() => {
      this.db.prepare('INSERT INTO credit_cards(id,ownerId,name,issuer,last4,defaultDebitAccountId,defaultCurrency,frequency,brand,iconAssetId,note,sortOrder) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, owner, input.name, input.issuer, input.last4, input.defaultDebitAccountId, input.defaultCurrency, input.frequency, input.brand, input.iconAssetId, input.note, this.nextOrder('credit_cards', owner));
      this.ledger.audit(owner, 'card.create', id, input); return this.ledger.owned('credit_cards', owner, id);
    })();
  }
  updateAccount(owner: string, id: string, body: unknown) {
    const input = accountInput.extend(versionInput.shape).parse(body);
    return this.db.transaction(() => {
      const before = this.ledger.owned('bank_accounts', owner, id); this.ownedAsset(owner, input.iconAssetId);
      const result = this.db.prepare('UPDATE bank_accounts SET name=?,bankName=?,bankCode=?,iconAssetId=?,note=?,version=version+1 WHERE id=? AND ownerId=? AND version=?').run(input.name, input.bankName, input.bankCode, input.iconAssetId, input.note, id, owner, input.version);
      if (!result.changes) throw new ConflictException('记录已更新，请刷新后重新编辑');
      this.ledger.audit(owner, 'account.update', id, {before, after: input}); return this.ledger.owned('bank_accounts', owner, id);
    })();
  }
  // 修改卡片只影响之后的默认值，不改写已有账单的扣款账户与币种。
  updateCard(owner: string, id: string, body: unknown) {
    const input = cardInput.extend(versionInput.shape).parse(body);
    return this.db.transaction(() => {
      const before = this.ledger.owned('credit_cards', owner, id);
      this.ledger.owned('bank_accounts', owner, input.defaultDebitAccountId, input.defaultDebitAccountId !== before.defaultDebitAccountId); this.ownedAsset(owner, input.iconAssetId);
      const result = this.db.prepare('UPDATE credit_cards SET name=?,issuer=?,last4=?,defaultDebitAccountId=?,defaultCurrency=?,frequency=?,brand=?,iconAssetId=?,note=?,version=version+1 WHERE id=? AND ownerId=? AND version=?').run(input.name, input.issuer, input.last4, input.defaultDebitAccountId, input.defaultCurrency, input.frequency, input.brand, input.iconAssetId, input.note, id, owner, input.version);
      if (!result.changes) throw new ConflictException('记录已更新，请刷新后重新编辑');
      this.ledger.audit(owner, 'card.update', id, {before, after: input}); return this.ledger.owned('credit_cards', owner, id);
    })();
  }
  archive(owner: string, kind: MasterTable, id: string) {
    this.ledger.owned(kind, owner, id);
    this.db.transaction(() => { this.db.prepare(`UPDATE ${kind} SET archivedAt=? WHERE id=? AND ownerId=?`).run(new Date().toISOString(), id, owner); this.ledger.audit(owner, 'archive', id, {kind}); })();
    return {ok: true};
  }
  // 提交完整顺序（含已归档项），避免部分提交与并发排序互相覆盖后出现重复序号。
  reorder(owner: string, kind: MasterTable, body: unknown) {
    const {ids} = reorderInput.parse(body);
    return this.db.transaction(() => {
      const current = (this.db.prepare(`SELECT id FROM ${kind} WHERE ownerId=?`).all(owner) as {id: string}[]).map(r => r.id);
      if (new Set(ids).size !== ids.length || ids.length !== current.length || !current.every(id => ids.includes(id))) throw new BadRequestException('排序列表与现有记录不一致，请刷新后重试');
      const update = this.db.prepare(`UPDATE ${kind} SET sortOrder=? WHERE id=? AND ownerId=?`);
      ids.forEach((id, index) => update.run(index + 1, id, owner));
      this.ledger.audit(owner, `${kind}.reorder`, owner, {ids});
      return kind === 'bank_accounts' ? this.accounts(owner) : this.cards(owner);
    })();
  }
}
