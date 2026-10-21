import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';

// 与 ios/useeCard/Core/Models.swift 中 Decodable 模型的必填字段一一对应（非可选字段必须存在且类型匹配，可选字段允许 null）。
// 修改任一侧时同步更新此清单；本测试不运行 Xcode，只校验服务端契约。
type Kind='string'|'number'|'boolean'|'array'|'object'|'date'|'month'|'string?'|'date?'|'object?';
const DATE=/^\d{4}-\d{2}-\d{2}$/, MONTH=/^\d{4}-\d{2}$/;
const models: Record<string,Record<string,Kind>>={
  ServerInfo:{service:'string',instanceId:'string',name:'string',appApiVersion:'number',authMethods:'array'},
  DeviceTokens:{tokenType:'string',accessToken:'string',accessExpiresAt:'string',refreshToken:'string',refreshExpiresAt:'string',instanceId:'string',user:'object',device:'object'},
  Me:{username:'string',defaultCurrency:'string',reminderDaysBefore:'number',reminderTime:'string',instanceId:'string',deviceId:'string?'},
  Preferences:{username:'string',defaultCurrency:'string',reminderDaysBefore:'number',reminderTime:'string'},
  Account:{id:'string',name:'string',bankName:'string',bankCode:'string',iconAssetId:'string?',note:'string',version:'number',archivedAt:'string?'},
  Card:{id:'string',name:'string',issuer:'string',last4:'string',defaultDebitAccountId:'string',defaultCurrency:'string',frequency:'string',brand:'string',iconAssetId:'string?',note:'string',version:'number',archivedAt:'string?'},
  Bill:{id:'string',cardId:'string',debitAccountId:'string',amountMinor:'number',currency:'string',dueDate:'date',statementMonth:'string?',note:'string',status:'string',version:'number',paidAt:'string?',cardName:'string',accountName:'string'},
  FundingSummary:{dueMonth:'month',accounts:'array',historicalPending:'array'},
  AccountGroup:{accountId:'string',accountName:'string',byCurrency:'array'},
  CurrencySummary:{currency:'string',pendingTotalMinor:'number',nextDueDate:'date?',byDate:'array'},
  Day:{dueDate:'date',amountMinor:'number',billCount:'number'},
  MonthlyReport:{dueMonth:'month',byCurrency:'array',bills:'array'},
  ReportGroup:{currency:'string',pendingMinor:'number',paidMinor:'number',totalMinor:'number',billCount:'number'},
  Review:{id:'string',cardId:'string',cardName:'string',frequency:'string',status:'string',version:'number',billIds:'array'},
  ReminderPlan:{generatedAt:'string',today:'date',daysBefore:'number',notifyTime:'string',items:'array',truncated:'boolean'},
  ReminderItem:{key:'string',accountId:'string',accountName:'string',dueDate:'date',currency:'string',amountMinor:'number',billCount:'number',notifyDate:'date',notifyTime:'string'},
};
function conforms(model: string, value: unknown){
  assert.equal(typeof value,'object',`${model} 应为对象`);
  for(const [field,kind] of Object.entries(models[model])){
    const v=(value as Record<string,unknown>)[field]; const where=`${model}.${field}`;
    if(kind.endsWith('?')){ if(v===null||v===undefined) continue; }
    else assert.notEqual(v,undefined,`${where} 缺失`);
    const base=kind.replace('?','');
    if(base==='date') assert.match(String(v),DATE,where);
    else if(base==='month') assert.match(String(v),MONTH,where);
    else if(base==='array') assert.ok(Array.isArray(v),where);
    else { assert.equal(typeof v,base,where); if(base==='number') assert.ok(Number.isSafeInteger(v),`${where} 应为安全整数`); }
  }
}
const statuses={bill:['pending','paid','void'],review:['unreviewed','no_new','reviewed']};

test('原生 App 契约：各接口返回 Swift 模型所需字段，写入请求体与 App 发送格式一致',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-contract-'));process.env.DATABASE_PATH=join(dir,'test.db');process.env.COOKIE_SECURE='false';
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 try{
  const json=async(path:string,init:RequestInit={},expect=200)=>{const r=await fetch(url+path,init);assert.equal(r.status,expect,`${init.method??'GET'} ${path}`);return r.json() as Promise<any>;};
  const setup=await fetch(url+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};const web={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const account=await json('/api/accounts',{method:'POST',headers:web,body:JSON.stringify({name:'三井住友',bankCode:'0009'})},201);
  const card=await json('/api/cards',{method:'POST',headers:web,body:JSON.stringify({name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'jcb',frequency:'low'})},201);

  conforms('ServerInfo',await json('/api/app/v1/server-info'));
  const {code}=await json('/api/devices/pairing-codes',{method:'POST',headers:web},201);
  const tokens=await json('/api/app/v1/auth/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,deviceName:'iPhone',platform:'ios'})},201);
  conforms('DeviceTokens',tokens);
  const auth={Authorization:`Bearer ${tokens.accessToken}`};const authJson={...auth,'Content-Type':'application/json'};

  // App 侧写入：BillInput 省略 statementMonth（Swift 合成编码不输出 nil），日期为 YYYY-MM-DD。
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());const month=today.slice(0,7);
  const bill=await json('/api/app/v1/bills',{method:'POST',headers:{...authJson,'Idempotency-Key':randomUUID()},body:JSON.stringify({cardId:card.id,debitAccountId:account.id,amountMinor:12345,currency:'JPY',dueDate:`${month}-28`,note:''})},201);
  conforms('Bill',bill);
  // BillUpdate 显式输出 statementMonth: null 与 confirmCurrencyChange。
  const edited=await json(`/api/app/v1/bills/${bill.id}`,{method:'PATCH',headers:authJson,body:JSON.stringify({cardId:card.id,debitAccountId:account.id,amountMinor:2050,currency:'USD',dueDate:`${month}-28`,statementMonth:null,note:'',version:bill.version,confirmCurrencyChange:true})});
  conforms('Bill',edited);assert.equal(edited.currency,'USD');
  const paid=await json(`/api/app/v1/bills/${bill.id}/paid`,{method:'POST',headers:authJson,body:JSON.stringify({version:edited.version})},201);
  assert.ok(statuses.bill.includes(paid.status));
  await json(`/api/app/v1/bills/${bill.id}/undo-paid`,{method:'POST',headers:authJson,body:JSON.stringify({version:paid.version})},201);

  conforms('Me',await json('/api/app/v1/me',{headers:auth}));
  const currencies=await json('/api/app/v1/currencies',{headers:auth});assert.equal(currencies.JPY,0);assert.equal(currencies.USD,2);
  (await json('/api/app/v1/accounts',{headers:auth})).forEach((a:unknown)=>conforms('Account',a));
  (await json('/api/app/v1/cards',{headers:auth})).forEach((c:unknown)=>conforms('Card',c));
  const bills=await json(`/api/app/v1/bills?dueMonth=${month}`,{headers:auth});assert.equal(bills.length,1);bills.forEach((b:unknown)=>conforms('Bill',b));
  assert.equal((await json(`/api/app/v1/bills?cardId=${card.id}`,{headers:auth})).length,1);
  const summary=await json(`/api/app/v1/summary?dueMonth=${month}`,{headers:auth});conforms('FundingSummary',summary);
  for(const group of summary.accounts){conforms('AccountGroup',group);for(const c of group.byCurrency){conforms('CurrencySummary',c);c.byDate.forEach((d:unknown)=>conforms('Day',d));}}
  assert.equal(summary.accounts[0].byCurrency[0].currency,'USD');
  const report=await json(`/api/app/v1/reports/monthly?dueMonth=${month}`,{headers:auth});conforms('MonthlyReport',report);report.byCurrency.forEach((g:unknown)=>conforms('ReportGroup',g));
  const plan=await json('/api/app/v1/reminders/plan',{headers:auth});conforms('ReminderPlan',plan);plan.items.forEach((i:unknown)=>conforms('ReminderItem',i));

  // 检查：start 不带请求体；confirm 的 items 含 billIds 与 unlinkConfirmed。
  const reviews=await json(`/api/app/v1/reviews/${month}/start`,{method:'POST',headers:auth},201);
  reviews.forEach((r:any)=>{conforms('Review',r);assert.ok(statuses.review.includes(r.status));});
  const confirmed=await json(`/api/app/v1/reviews/${month}/confirm`,{method:'POST',headers:authJson,body:JSON.stringify({items:[{id:reviews[0].id,version:reviews[0].version,status:'reviewed',billIds:[bill.id],unlinkConfirmed:false}]})},201);
  conforms('Review',confirmed[0]);assert.equal(confirmed[0].status,'reviewed');
  (await json(`/api/app/v1/reviews?reviewMonth=${month}`,{headers:auth})).forEach((r:unknown)=>conforms('Review',r));
  const late=await json('/api/cards',{method:'POST',headers:web,body:JSON.stringify({name:'新卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY'})},201);
  assert.equal((await json(`/api/app/v1/reviews/${month}/cards`,{method:'POST',headers:authJson,body:JSON.stringify({cardIds:[late.id]})},201)).length,2);

  // 设置：Swift 只编码非 nil 字段。
  conforms('Preferences',await json('/api/app/v1/settings',{method:'PATCH',headers:authJson,body:JSON.stringify({reminderDaysBefore:2,reminderTime:'08:30'})}));

  // 刷新与注销：响应为 200，刷新结果仍是 DeviceTokens。
  conforms('DeviceTokens',await json('/api/app/v1/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:tokens.refreshToken})}));
 }finally{app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
