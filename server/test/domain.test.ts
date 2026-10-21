import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseService} from '../src/database.js';
import {LedgerService} from '../src/common/ledger.service.js';
import {AccountsService} from '../src/accounts/accounts.service.js';
import {BillsService} from '../src/bills/bills.service.js';
import {ReviewsService} from '../src/reviews/reviews.service.js';
import {ReportsService} from '../src/reports/reports.service.js';
import {SettingsService} from '../src/settings/settings.service.js';
import {RemindersService} from '../src/reminders/reminders.service.js';
import type {Account, Card} from '@ccm/shared';
function fixture(){
  const database=new DatabaseService(':memory:'); const owner=randomUUID();
  database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(owner,'test','unused');
  const ledger=new LedgerService(database); const accounts=new AccountsService(ledger); const bills=new BillsService(ledger);
  const reviews=new ReviewsService(ledger,bills,accounts); const reports=new ReportsService(bills,accounts); const settings=new SettingsService(ledger);
  const account=accounts.createAccount(owner,{name:'备款账户'}) as unknown as Account;
  const card=accounts.createCard(owner,{name:'常用卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY'}) as unknown as Card;
  const input={cardId:card.id,debitAccountId:account.id,amountMinor:10000,currency:'JPY',dueDate:'2026-11-01'};
  return {database,accounts,bills,reviews,reports,settings,owner,account,card,input};
}
test('同卡多账单、跨币种、归档、已还与撤销按同一规则汇总',()=>{
  const {database,accounts,bills,reviews,reports,settings,owner,account,card,input}=fixture();
  try{
    const a=bills.createBill(owner,input,randomUUID());
    bills.createBill(owner,{...input,amountMinor:20000},randomUUID());
    bills.createBill(owner,{...input,amountMinor:1234,currency:'USD'},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-10-10'},randomUUID());
    let summary=reports.summary(owner,'2026-11');
    assert.equal(summary.accounts[0].byCurrency.find(c=>c.currency==='JPY')?.pendingTotalMinor,30000);
    assert.equal(summary.accounts[0].byCurrency.find(c=>c.currency==='USD')?.pendingTotalMinor,1234);
    assert.equal(summary.historicalPending.length,1);
    assert.equal(reports.summary(owner,'2026-11','USD').accounts[0].byCurrency.length,1);
    accounts.archive(owner,'bank_accounts',account.id);accounts.archive(owner,'credit_cards',card.id);
    assert.equal(reports.summary(owner,'2026-11').accounts.length,1);
    const paid=bills.transition(owner,a.id,'paid',{version:a.version});
    assert.equal(reports.summary(owner,'2026-11','JPY').accounts[0].byCurrency[0].pendingTotalMinor,20000);
    bills.transition(owner,a.id,'undo-paid',{version:paid.version});
    assert.equal(reports.summary(owner,'2026-11','JPY').accounts[0].byCurrency[0].pendingTotalMinor,30000);
  }finally{database.close();}
});
test('重复请求不重复创建，异载荷同键与并发编辑冲突拒绝',()=>{
  const {database,accounts,bills,reviews,reports,settings,owner,input}=fixture();
  try{
    const key=randomUUID();const bill=bills.createBill(owner,input,key);
    assert.equal(bills.createBill(owner,input,key).id,bill.id);
    assert.equal(bills.bills(owner).length,1);
    assert.throws(()=>bills.createBill(owner,{...input,amountMinor:2},key),/相同请求/);
    bills.updateBill(owner,bill.id,{...input,amountMinor:12000,version:1});
    assert.throws(()=>bills.updateBill(owner,bill.id,{...input,version:1}),/记录已更新/);
    assert.equal(bills.bill(owner,bill.id).amountMinor,12000);
  }finally{database.close();}
});
test('无新增不抵消账单；跨月关联；作废最后关联项恢复未确认',()=>{
  const {database,accounts,bills,reviews,reports,settings,owner,input}=fixture();
  try{
    const bill=bills.createBill(owner,input,randomUUID()); const review=reviews.startReview(owner,'2026-10')[0];
    reviews.confirmReview(owner,'2026-10',{items:[{id:review.id,version:review.version,status:'no_new'}]});
    assert.equal(reports.summary(owner,'2026-11').accounts[0].byCurrency[0].pendingTotalMinor,10000);
    assert.equal(bills.bills(owner).length,1);
    const current=reviews.reviews(owner,'2026-10')[0];
    reviews.confirmReview(owner,'2026-10',{items:[{id:current.id,version:current.version,status:'reviewed',billIds:[bill.id]}]});
    assert.equal(reports.summary(owner,'2026-10').accounts.length,0);
    bills.transition(owner,bill.id,'void',{version:bill.version});
    assert.equal(reviews.reviews(owner,'2026-10')[0].status,'unreviewed');
    assert.equal(reports.summary(owner,'2026-11').accounts.length,0);
  }finally{database.close();}
});
test('批量检查事务回滚、所有权隔离、币种修改须确认',()=>{
 const {database,accounts,bills,reviews,reports,settings,owner,input}=fixture();
 try{
  const bill=bills.createBill(owner,input,randomUUID()); const review=reviews.startReview(owner,'2026-10')[0];
  assert.throws(()=>reviews.confirmReview(owner,'2026-10',{items:[{id:review.id,version:1,status:'no_new'},{id:randomUUID(),version:1,status:'no_new'}]}));
  assert.equal(reviews.reviews(owner,'2026-10')[0].status,'unreviewed');
  assert.throws(()=>bills.bill(randomUUID(),bill.id),/不存在/);
  assert.throws(()=>bills.updateBill(owner,bill.id,{...input,currency:'USD',version:1}),/重新确认/);
  assert.equal(bills.bill(owner,bill.id).currency,'JPY');
  settings.setPreferences(owner,{defaultCurrency:'USD'});
  assert.equal(bills.bill(owner,bill.id).currency,'JPY');
 }finally{database.close();}
});
test('账户/卡片编辑校验版本，不改写已有账单；按卡筛选账单',()=>{
  const {database,accounts,bills,reviews,reports,settings,owner,account,card,input}=fixture();
  try{
    const bill=bills.createBill(owner,input,randomUUID());
    const other=accounts.createAccount(owner,{name:'新账户'}) as unknown as Account;
    const edited=accounts.updateCard(owner,card.id,{name:'改名卡',defaultDebitAccountId:other.id,defaultCurrency:'USD',note:'年费卡',version:1}) as unknown as Card;
    assert.equal(edited.version,2);assert.equal(edited.note,'年费卡');
    assert.throws(()=>accounts.updateCard(owner,card.id,{name:'旧版本',defaultDebitAccountId:other.id,defaultCurrency:'USD',version:1}),/已更新/);
    const after=bills.bill(owner,bill.id);assert.equal(after.debitAccountId,account.id);assert.equal(after.currency,'JPY');
    accounts.archive(owner,'bank_accounts',account.id);
    assert.throws(()=>accounts.updateCard(owner,card.id,{name:'改回',defaultDebitAccountId:account.id,defaultCurrency:'USD',version:2}),/已归档/);
    assert.equal((accounts.updateAccount(owner,account.id,{name:'归档账户改名',version:1}) as unknown as Account).name,'归档账户改名');
    assert.throws(()=>accounts.updateAccount(randomUUID(),account.id,{name:'越权',version:2}),/不存在/);
    const card2=accounts.createCard(owner,{name:'第二张',defaultDebitAccountId:other.id,defaultCurrency:'JPY'}) as unknown as Card;
    bills.createBill(owner,{...input,cardId:card2.id,debitAccountId:other.id},randomUUID());
    assert.deepEqual(bills.bills(owner,{cardId:card.id}).map(b=>b.id),[bill.id]);
  }finally{database.close();}
});
test('清单创建后新增的卡片需显式加入，重复与归档卡拒绝',()=>{
  const {database,accounts,bills,reviews,reports,settings,owner,account}=fixture();
  try{
    assert.equal(reviews.startReview(owner,'2026-10').length,1);
    const late=accounts.createCard(owner,{name:'新卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY'}) as unknown as Card;
    assert.equal(reviews.startReview(owner,'2026-10').length,1);
    assert.equal(reviews.addReviewCards(owner,'2026-10',{cardIds:[late.id]}).length,2);
    assert.throws(()=>reviews.addReviewCards(owner,'2026-10',{cardIds:[late.id]}),/已在本轮/);
    const archived=accounts.createCard(owner,{name:'归档卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY'}) as unknown as Card;
    accounts.archive(owner,'credit_cards',archived.id);
    assert.throws(()=>reviews.addReviewCards(owner,'2026-10',{cardIds:[archived.id]}),/已归档/);
    assert.throws(()=>reviews.addReviewCards(owner,'2026-11',{cardIds:[late.id]}),/尚未创建/);
  }finally{database.close();}
});
test('显示顺序：完整列表才可保存，影响列表、检查清单与汇总账户顺序',()=>{
  const {database,accounts,bills,reviews,reports,owner,account,card,input}=fixture();
  try{
    const second=accounts.createAccount(owner,{name:'第二账户'}) as unknown as Account;
    const card2=accounts.createCard(owner,{name:'第二卡',defaultDebitAccountId:second.id,defaultCurrency:'JPY'}) as unknown as Card;
    assert.deepEqual(accounts.cards(owner).map(c=>c.id),[card.id,card2.id]);
    assert.deepEqual(accounts.reorder(owner,'credit_cards',{ids:[card2.id,card.id]}).map(c=>c.id),[card2.id,card.id]);
    assert.deepEqual(reviews.startReview(owner,'2026-10').map(r=>r.cardId),[card2.id,card.id]);
    assert.throws(()=>accounts.reorder(owner,'credit_cards',{ids:[card.id]}),/不一致/);
    assert.throws(()=>accounts.reorder(owner,'credit_cards',{ids:[card.id,card.id]}),/不一致/);
    assert.throws(()=>accounts.reorder(randomUUID(),'credit_cards',{ids:[card.id,card2.id]}),/不一致/);
    bills.createBill(owner,input,randomUUID());bills.createBill(owner,{...input,cardId:card2.id,debitAccountId:second.id},randomUUID());
    accounts.reorder(owner,'bank_accounts',{ids:[second.id,account.id]});
    assert.deepEqual(reports.summary(owner,'2026-11').accounts.map(a=>a.accountId),[second.id,account.id]);
    const third=accounts.createAccount(owner,{name:'第三账户'}) as unknown as Account;
    assert.equal(accounts.accounts(owner).at(-1)?.id,third.id);
  }finally{database.close();}
});
test('账单搜索：多条件组合、日期闭区间、倒序分页与参数校验',()=>{
  const {database,accounts,bills,owner,account,card,input}=fixture();
  try{
    const other=accounts.createAccount(owner,{name:'其他账户'}) as unknown as Account;
    for(let day=1;day<=25;day++) bills.createBill(owner,{...input,dueDate:`2026-11-${String(day).padStart(2,'0')}`},randomUUID());
    const usd=bills.createBill(owner,{...input,currency:'USD',debitAccountId:other.id,dueDate:'2026-12-05'},randomUUID());
    const first=bills.search(owner,{});
    assert.equal(first.total,26);assert.equal(first.items.length,20);assert.equal(first.items[0].id,usd.id);
    const second=bills.search(owner,{page:'2',pageSize:'20'});
    assert.equal(second.items.length,6);assert.equal(second.items.at(-1)?.dueDate,'2026-11-01');
    assert.equal(bills.search(owner,{from:'2026-11-10',to:'2026-11-12'}).total,3);
    assert.equal(bills.search(owner,{currency:'USD'}).total,1);
    assert.equal(bills.search(owner,{accountId:other.id}).total,1);
    assert.equal(bills.search(owner,{cardId:card.id,accountId:account.id,currency:'JPY',status:'pending'}).total,25);
    assert.equal(bills.search(owner,{cardId:'',status:''}).total,26);
    assert.equal(bills.search(randomUUID(),{}).total,0);
    assert.throws(()=>bills.search(owner,{from:'2026-12-01',to:'2026-11-01'}),/开始日期/);
    assert.throws(()=>bills.search(owner,{pageSize:'500'}));
    assert.throws(()=>bills.search(owner,{unknown:'1'}));
  }finally{database.close();}
});
test('提醒计划：按账户＋日期＋币种合并待还账单，提前天数与当天兜底，排除已还/作废/过去',()=>{
  const {database,accounts,bills,settings,owner,account,card,input}=fixture();
  try{
    const reminders=new RemindersService(bills,settings,accounts);
    settings.setPreferences(owner,{reminderDaysBefore:3,reminderTime:'08:30'});
    const other=accounts.createAccount(owner,{name:'第二账户'}) as unknown as Account;
    bills.createBill(owner,{...input,dueDate:'2026-11-10',amountMinor:1000},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-11-10',amountMinor:2000},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-11-10',amountMinor:150,currency:'USD'},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-11-10',amountMinor:500,debitAccountId:other.id},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-10-22',amountMinor:700},randomUUID());
    bills.createBill(owner,{...input,dueDate:'2026-10-01',amountMinor:9},randomUUID());
    const paid=bills.createBill(owner,{...input,dueDate:'2026-11-20'},randomUUID());bills.transition(owner,paid.id,'paid',{version:1});
    const voided=bills.createBill(owner,{...input,dueDate:'2026-11-21'},randomUUID());bills.transition(owner,voided.id,'void',{version:1});
    const plan=reminders.plan(owner,'2026-10-21');
    assert.equal(plan.daysBefore,3);assert.equal(plan.notifyTime,'08:30');assert.equal(plan.truncated,false);
    assert.deepEqual(plan.items.map(i=>[i.accountId===account.id?'A':'B',i.dueDate,i.currency,i.amountMinor,i.billCount,i.notifyDate]),[
      ['A','2026-10-22','JPY',700,1,'2026-10-21'],
      ['A','2026-11-10','JPY',3000,2,'2026-11-07'],
      ['A','2026-11-10','USD',150,1,'2026-11-07'],
      ['B','2026-11-10','JPY',500,1,'2026-11-07'],
    ]);
    assert.ok(plan.items.every(i=>i.notifyTime==='08:30'&&i.key.includes(i.dueDate)));
    assert.throws(()=>settings.setPreferences(owner,{reminderTime:'25:00'}));
    assert.throws(()=>settings.setPreferences(owner,{}));
    assert.throws(()=>settings.setPreferences(owner,{reminderDaysBefore:31}));
    for(let d=1;d<=28;d++) for(const currency of ['JPY','USD','CNY']) bills.createBill(owner,{...input,currency,dueDate:`2026-12-${String(d).padStart(2,'0')}`},randomUUID());
    const big=reminders.plan(owner,'2026-10-21');
    assert.equal(big.items.length,60);assert.equal(big.truncated,true);assert.equal(big.items[0].dueDate,'2026-10-22');
  }finally{database.close();}
});
