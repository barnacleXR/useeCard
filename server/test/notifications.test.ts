import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../src/database.js';
import { LedgerService } from '../src/common/ledger.service.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { BillsService } from '../src/bills/bills.service.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { MaintenanceService } from '../src/data-management/maintenance.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { createApp } from '../src/app.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function fixture(){
 const database=new DatabaseService(':memory:'),owner=randomUUID(),ledger=new LedgerService(database),accounts=new AccountsService(ledger),bills=new BillsService(ledger),settings=new SettingsService(ledger),maintenance=new MaintenanceService();
 database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(owner,'owner','unused');
 const account=accounts.createAccount(owner,{name:'备款账户'}) as any,card=accounts.createCard(owner,{name:'卡片',defaultDebitAccountId:account.id,defaultCurrency:'JPY'}) as any;
 const service=new NotificationsService(ledger,bills,settings,maintenance);
 const input={cardId:card.id,debitAccountId:account.id,amountMinor:10000,currency:'JPY',dueDate:'2026-10-23'};
 const rows=()=>database.db.prepare('SELECT * FROM notifications WHERE ownerId=? ORDER BY notificationKey').all(owner) as any[];
 return {database,owner,accounts,account,bills,card,settings,service,input,rows};
}
test('站内提醒按日本时间触发、账户日期币种分组，重启去重，保留已读状态',()=>{
 const f=fixture();try{
  f.settings.setPreferences(f.owner,{reminderDaysBefore:2,reminderTime:'09:00'});
  f.bills.createBill(f.owner,f.input,randomUUID());f.bills.createBill(f.owner,{...f.input,amountMinor:20000},randomUUID());
  f.bills.createBill(f.owner,{...f.input,amountMinor:1234,currency:'USD'},randomUUID());
  f.bills.createBill(f.owner,{...f.input,dueDate:'2026-10-24'},randomUUID());
  f.service.sync(f.owner,new Date('2026-10-20T23:59:59Z'));assert.equal(f.rows().length,0);
  f.service.sync(f.owner,new Date('2026-10-21T00:00:00Z'));assert.equal(f.rows().length,2);
  const jpy=f.rows().find(v=>JSON.parse(v.payload).currency==='JPY');assert.equal(JSON.parse(jpy.payload).amountMinor,30000);assert.equal(JSON.parse(jpy.payload).billCount,2);
  f.service.read(f.owner,{items:[{id:jpy.id,version:jpy.version}]});assert.ok(f.rows().find(v=>v.id===jpy.id).readAt);
  const restarted=new NotificationsService(new LedgerService(f.database),f.bills,f.settings,new MaintenanceService());restarted.sync(f.owner,new Date('2026-10-21T00:01:00Z'));
  assert.equal(f.rows().length,2);assert.ok(f.rows().find(v=>v.id===jpy.id).readAt);
 }finally{f.database.close();}
});
test('金额修改重新标为未读，日期修改和已还作废移入历史，撤销后恢复，归档不丢账单',()=>{
 const f=fixture();try{
  let bill=f.bills.createBill(f.owner,f.input,randomUUID()) as any;
  const now=new Date('2026-10-23T02:00:00Z');f.service.sync(f.owner,now);let row=f.rows()[0];f.service.read(f.owner,{items:[{id:row.id,version:row.version}]});
  const oldVersion=row.version;
  bill=f.bills.updateBill(f.owner,bill.id,{...f.input,amountMinor:20000,version:bill.version}) as any;
  f.service.sync(f.owner,now);row=f.rows()[0];assert.equal(row.readAt,null);assert.equal(JSON.parse(row.payload).amountMinor,20000);
  f.service.read(f.owner,{items:[{id:row.id,version:oldVersion}]});assert.equal(f.rows().find(v=>v.id===row.id).readAt,null,'旧页面不能把新金额提醒标为已读');
  bill=f.bills.updateBill(f.owner,bill.id,{...f.input,dueDate:'2026-10-30',version:bill.version}) as any;f.service.sync(f.owner,now);assert.ok(f.rows()[0].resolvedAt);
  f.service.sync(f.owner,new Date('2026-10-30T02:00:00Z'));assert.equal(f.rows().filter(v=>!v.resolvedAt).length,1);
  bill=f.bills.transition(f.owner,bill.id,'paid',{version:bill.version}) as any;f.service.sync(f.owner,new Date('2026-10-30T02:00:00Z'));assert.equal(f.rows().filter(v=>!v.resolvedAt).length,0);
  bill=f.bills.transition(f.owner,bill.id,'undo-paid',{version:bill.version}) as any;
  f.accounts.archive(f.owner,'credit_cards',f.card.id);f.accounts.archive(f.owner,'bank_accounts',f.account.id);
  f.service.sync(f.owner,new Date('2026-10-30T02:00:00Z'));assert.equal(f.rows().filter(v=>!v.resolvedAt).length,1);
  bill=f.bills.transition(f.owner,bill.id,'void',{version:bill.version}) as any;f.service.sync(f.owner,new Date('2026-10-30T02:00:00Z'));assert.equal(f.rows().filter(v=>!v.resolvedAt).length,0);
 }finally{f.database.close();}
});
test('过日提醒独立未读、关闭与恢复通知、所有权、分页和参数校验',()=>{
 const f=fixture();try{
  f.bills.createBill(f.owner,f.input,randomUUID());f.service.sync(f.owner,new Date('2026-10-23T01:00:00Z'));const original=f.rows()[0];f.service.read(f.owner,{items:[{id:original.id,version:original.version}]});
  f.service.sync(f.owner,new Date('2026-10-23T15:00:00Z'));assert.ok(f.rows().find(v=>v.id===original.id).resolvedAt);const overdue=f.rows().find(v=>!v.resolvedAt);assert.equal(overdue.kind,'overdue');assert.equal(overdue.readAt,null);
  f.settings.setPreferences(f.owner,{inAppNotifications:false});f.service.sync(f.owner,new Date('2026-10-24T01:00:00Z'));assert.equal(f.rows().filter(v=>!v.resolvedAt).length,0);
  f.settings.setPreferences(f.owner,{inAppNotifications:true});f.service.sync(f.owner,new Date('2026-10-24T01:00:00Z'));assert.equal(f.rows().length,2);assert.equal(f.rows().find(v=>!v.resolvedAt).readAt,null);
  const foreign=randomUUID();f.database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(foreign,'other','unused');
  f.service.read(foreign,{items:[{id:overdue.id,version:overdue.version}]});assert.equal(f.rows().find(v=>v.id===overdue.id).readAt,null);
  for(let i=0;i<3;i++)f.service.test(f.owner);
  const first=f.service.list(f.owner,{filter:'history',pageSize:1}),second=f.service.list(f.owner,{filter:'history',pageSize:1,page:2});assert.equal(first.total,5);assert.notEqual(first.items[0].id,second.items[0].id);
  assert.equal(f.service.list(foreign,{filter:'history'}).total,0);
  assert.throws(()=>f.service.list(f.owner,{pageSize:101}));assert.throws(()=>f.service.list(f.owner,{filter:'bad'}));
  f.service.readAll(f.owner);assert.equal(f.service.unread(f.owner).unreadCount,0);
 }finally{f.database.close();}
});
test('站内通知 HTTP 认证、CSRF、测试、已读与设置持久化',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-notifications-'));process.env.DATABASE_PATH=join(dir,'data.db');process.env.COOKIE_SECURE='false';
 const app=await createApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const request=(path:string,method='GET',body?:unknown,cookie='',csrf='')=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await request('/notifications')).status,401);
  const login=await request('/auth/setup','POST',{username:'owner',password:'a-good-password-123'}),cookie=login.headers.get('set-cookie')!.split(';')[0],{csrf}=await login.json() as any;
  assert.equal((await request('/notifications/test','POST',{},cookie)).status,403);
  const created=await request('/notifications/test','POST',{},cookie,csrf);assert.equal(created.status,201);const {id}=await created.json() as any;
  let page=await (await request('/notifications?filter=unread','GET',undefined,cookie)).json() as any;assert.equal(page.total,1);assert.equal(page.items[0].id,id);
  assert.equal((await request('/notifications/read','POST',{items:[{id,version:1}]},cookie,csrf)).status,201);
  page=await (await request('/notifications?filter=unread','GET',undefined,cookie)).json() as any;assert.equal(page.total,0);
  const settings=await request('/settings','PATCH',{inAppNotifications:false},cookie,csrf);assert.equal(settings.status,200);assert.equal((await settings.json() as any).inAppNotifications,false);
  assert.equal((await request('/notification-channels','POST',{name:'TG',service:'telegram',url:'tgram://123456:TEST_TOKEN/987'},cookie)).status,403);
  const channels=await request('/notification-channels','POST',{name:'TG',service:'telegram',url:'tgram://123456:TEST_TOKEN/987'},cookie,csrf);assert.equal(channels.status,201);const channelState=await channels.json() as any;assert.ok(!JSON.stringify(channelState).includes('TEST_TOKEN'));
  assert.equal((await request('/notification-channels/test','POST',{channelId:channelState.channels[0].id},cookie,csrf)).status,503);
  assert.equal((await request('/notifications?page=0','GET',undefined,cookie)).status,400);
 }finally{await app.close();app.get(DatabaseService).close();rmSync(dir,{recursive:true,force:true});}
});
