import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../src/database.js';
import { LedgerService } from '../src/common/ledger.service.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { BillsService } from '../src/bills/bills.service.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { MaintenanceService } from '../src/data-management/maintenance.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { AppriseService } from '../src/notifications/apprise.service.js';
import { buildNotifyUrl } from '../../client/src/notify-services.js';
import { japanToday } from '@ccm/shared';
function fixture(){
 const database=new DatabaseService(':memory:'),owner=randomUUID(),ledger=new LedgerService(database),accounts=new AccountsService(ledger),bills=new BillsService(ledger),settings=new SettingsService(ledger),maintenance=new MaintenanceService();
 database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(owner,'owner','unused');
 const notifications=new NotificationsService(ledger,bills,settings,maintenance),service=new AppriseService(ledger,notifications,maintenance);
 const account=accounts.createAccount(owner,{name:'备款账户'}) as any,card=accounts.createCard(owner,{name:'卡片',defaultDebitAccountId:account.id,defaultCurrency:'JPY'}) as any;
 settings.setPreferences(owner,{reminderTime:'00:00'});
 const input={cardId:card.id,debitAccountId:account.id,dueDate:japanToday(),amountMinor:1234,currency:'JPY'};
 return {database,owner,ledger,bills,settings,maintenance,notifications,service,input};
}
async function gateway(){
 const messages:any[]=[];let status=200;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;messages.push({payload:JSON.parse(body),authorization:req.headers.authorization});res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({details:'secret-token-must-not-leak'}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
 process.env.APPRISE_API_URL=`http://127.0.0.1:${address.port}/notify`;
 return {messages,setStatus:(n:number)=>status=n,close:async()=>{delete process.env.APPRISE_API_URL;delete process.env.APPRISE_API_USERNAME;delete process.env.APPRISE_API_PASSWORD;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
test('Apprise 通道不回显密钥，所有权/版本/重复检查，测试消息与错误不泄露凭证',async()=>{
 const f=fixture(),g=await gateway();try{
  const secret='tgram://123456:TEST_TOKEN/987654';
  const state=f.service.create(f.owner,{name:'我的 TG',service:'telegram',url:secret});const channel=state.channels[0];
  assert.equal(channel.enabled,false);assert.ok(!JSON.stringify(state).includes('TEST_TOKEN'));
  assert.throws(()=>f.service.create(f.owner,{name:'重复',service:'telegram',url:secret}),/已经配置/);
  assert.throws(()=>f.service.update(f.owner,channel.id,{version:99,enabled:true}),/已被修改/);
  const other=randomUUID();f.database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(other,'other','unused');
  assert.throws(()=>f.service.update(other,channel.id,{version:1,enabled:true}),/不存在/);
  assert.equal(f.service.state(other).channels.length,0);
  process.env.APPRISE_API_USERNAME='gateway-user';process.env.APPRISE_API_PASSWORD='gateway-pass';
  await f.service.test(f.owner,{channelId:channel.id});assert.equal(g.messages[0].payload.urls,secret);assert.ok(g.messages[0].authorization.startsWith('Basic '));assert.ok(!g.messages[0].payload.body.includes('账户：'));
  g.setStatus(424);await assert.rejects(f.service.test(f.owner,{channelId:channel.id}),/HTTP 424/);
  const after=JSON.stringify(f.service.state(f.owner));assert.ok(!after.includes('TEST_TOKEN'));assert.ok(!after.includes('secret-token-must-not-leak'));
  assert.ok(!JSON.stringify(f.database.db.prepare('SELECT changes FROM audit_events').all()).includes(secret));
  f.service.update(f.owner,channel.id,{version:1},true);assert.equal(f.service.state(f.owner).channels.length,0);assert.equal(f.service.state(f.owner).deliveries.length,2);
 }finally{await f.service.onModuleDestroy();f.database.close();await g.close();}
});
test('Apprise 自动分币种发送、独立于站内开关、去重、更新金额和作废取消旧任务',async()=>{
 const f=fixture(),g=await gateway();try{
  f.settings.setPreferences(f.owner,{inAppNotifications:false});
  f.service.create(f.owner,{name:'TG',service:'telegram',url:'tgram://123456:TOKEN/987',enabled:true});
  let bill=f.bills.createBill(f.owner,f.input,randomUUID()) as any;
  f.bills.createBill(f.owner,{...f.input,currency:'USD'},randomUUID());
  await f.service.run();assert.equal(g.messages.length,2);assert.ok(g.messages.some(v=>v.payload.body.includes('JPY 1,234')));assert.ok(g.messages.some(v=>v.payload.body.includes('USD 12.34')));
  assert.equal(f.notifications.unread(f.owner).unreadCount,0,'关闭站内不影响外部发送');
  await f.service.run();assert.equal(g.messages.length,2,'已发送版本不重复');
  bill=f.bills.updateBill(f.owner,bill.id,{...f.input,amountMinor:2000,version:bill.version}) as any;await f.service.run();assert.equal(g.messages.length,3);assert.ok(g.messages.at(-1).payload.body.includes('JPY 2,000'));
  g.setStatus(500);bill=f.bills.updateBill(f.owner,bill.id,{...f.input,amountMinor:3000,version:bill.version}) as any;await f.service.run();
  const failed=f.database.db.prepare("SELECT * FROM notification_deliveries WHERE status='failed'").get() as any;assert.ok(failed.nextAttemptAt);assert.equal(failed.attempts,1);
  f.bills.transition(f.owner,bill.id,'void',{version:bill.version});
  assert.throws(()=>f.service.retry(f.owner,failed.id),/已变化/);
  f.database.db.prepare('UPDATE notification_deliveries SET nextAttemptAt=? WHERE id=?').run('2000-01-01',failed.id);await f.service.run();
  assert.equal((f.database.db.prepare('SELECT status FROM notification_deliveries WHERE id=?').get(failed.id) as any).status,'cancelled');assert.equal(g.messages.length,4);
 }finally{await f.service.onModuleDestroy();f.database.close();await g.close();}
});
test('失败重试上限、手动重试和维护期间暂停后台投递',async()=>{
 const f=fixture(),g=await gateway();try{
  f.service.create(f.owner,{name:'TG',service:'telegram',url:'tgram://123456:TOKEN/987',enabled:true});f.bills.createBill(f.owner,f.input,randomUUID());
  g.setStatus(424);await f.service.run();let row=f.database.db.prepare('SELECT * FROM notification_deliveries').get() as any;
  for(let n=0;n<2;n++){f.database.db.prepare('UPDATE notification_deliveries SET nextAttemptAt=? WHERE id=?').run('2000-01-01',row.id);await f.service.run();}
  row=f.database.db.prepare('SELECT * FROM notification_deliveries').get() as any;assert.equal(row.attempts,3);assert.equal(row.nextAttemptAt,null);await f.service.run();assert.equal(g.messages.length,3);
  f.service.retry(f.owner,row.id);g.setStatus(200);await f.maintenance.enter();await f.service.run();assert.equal(g.messages.length,3);f.maintenance.leave();await f.service.run();assert.equal(g.messages.length,4);
  assert.equal((f.database.db.prepare('SELECT status FROM notification_deliveries').get() as any).status,'sent');
 }finally{await f.service.onModuleDestroy();f.database.close();await g.close();}
});
test('通知表单按 Apprise 格式构建 Telegram、SMTP、Discord 和其他服务',()=>{
 assert.equal(buildNotifyUrl('telegram',{token:'123456:TEST_TOKEN',chat:'-100123'}),'tgram://123456:TEST_TOKEN/-100123');
 assert.equal(buildNotifyUrl('discord',{webhook:'https://discord.com/api/webhooks/123/TEST_TOKEN'}),'discord://123/TEST_TOKEN/');
 const email=new URL(buildNotifyUrl('email',{host:'smtp.example.com',port:'465',tls:'ssl',user:'me@example.com',password:'a&b+c',sender:'me@example.com',recipient:'other@example.com'}));
 assert.equal(email.protocol,'mailtos:');assert.equal(email.searchParams.get('pass'),'a&b+c');assert.equal(email.searchParams.get('to'),'other@example.com');assert.equal(email.searchParams.get('smtp'),'smtp.example.com');
 assert.equal(buildNotifyUrl('bark',{key:'TEST_KEY'}),'bark://api.day.app/TEST_KEY');assert.equal(buildNotifyUrl('ntfy',{topic:'long_random_topic'}),'ntfys://long_random_topic');
 assert.throws(()=>buildNotifyUrl('discord',{webhook:'https://example.com/webhook'}));assert.throws(()=>buildNotifyUrl('telegram',{token:'bad',chat:'123'}));
});
