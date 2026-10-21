import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import type {DeviceTokens} from '@ccm/shared';

test('原生 API：凭证隔离、密码登录、配对码单次消费、刷新轮换与泄露吊销、撤销与注销',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-devices-'));process.env.DATABASE_PATH=join(dir,'test.db');process.env.COOKIE_SECURE='false';
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const bearer=(t:DeviceTokens)=>({Authorization:`Bearer ${t.accessToken}`});
 try{
  const info=await (await call('/app/v1/server-info')).json() as Record<string,unknown>;
  assert.deepEqual(Object.keys(info).sort(),['appApiVersion','authMethods','instanceId','name','service']);
  assert.equal(info.service,'useecard');assert.equal(info.appApiVersion,1);

  const setup=await call('/auth/setup','POST',{username:'owner',password:'a-good-password-123'});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};const web={Cookie:cookie,'X-CSRF-Token':csrf};
  const account=await (await call('/accounts','POST',{name:'备款账户'},web)).json() as {id:string};
  const card=await (await call('/cards','POST',{name:'常用卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY'},web)).json() as {id:string};

  // 密码登录：错误密码拒绝；成功后令牌只作用于 /api/app/v1。
  assert.equal((await call('/app/v1/auth/login','POST',{username:'owner',password:'wrong-password',deviceName:'iPhone'})).status,401);
  const login=await call('/app/v1/auth/login','POST',{username:'owner',password:'a-good-password-123',deviceName:'iPhone 17'});assert.equal(login.status,201);
  const phone=await login.json() as DeviceTokens;
  assert.match(phone.accessToken,/^ccma_/);assert.match(phone.refreshToken,/^ccmr_/);assert.equal(phone.instanceId,info.instanceId);assert.equal(phone.user.username,'owner');
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(phone))).status,200);
  assert.equal((await call('/app/v1/accounts','GET',undefined,{Cookie:cookie})).status,401,'Web Cookie 不能访问原生 API');
  assert.equal((await call('/accounts','GET',undefined,bearer(phone))).status,401,'设备令牌不能访问 Web API');
  assert.equal((await call('/devices','GET',undefined,bearer(phone))).status,401,'设备令牌不能管理设备');
  assert.equal((await call('/app/v1/accounts','GET',undefined,{Authorization:`Bearer ${phone.refreshToken}`})).status,401,'刷新令牌不能当访问令牌');

  // 原生写入与 Web 共用领域服务：无需 CSRF，幂等键仍必需。
  const bill={cardId:card.id,debitAccountId:account.id,amountMinor:12345,currency:'JPY',dueDate:'2026-11-27'};
  assert.equal((await call('/app/v1/bills','POST',bill,bearer(phone))).status,400);
  const created=await call('/app/v1/bills','POST',bill,{...bearer(phone),'Idempotency-Key':randomUUID()});assert.equal(created.status,201);
  const webBills=await (await call('/bills?dueMonth=2026-11','GET',undefined,{Cookie:cookie})).json() as {amountMinor:number;currency:string}[];
  assert.deepEqual(webBills.map(b=>[b.amountMinor,b.currency]),[[12345,'JPY']]);
  const me=await (await call('/app/v1/me','GET',undefined,bearer(phone))).json() as {deviceId:string;reminderDaysBefore:number};
  assert.equal(me.deviceId,phone.device.id);assert.equal(me.reminderDaysBefore,1);
  const plan=await (await call('/app/v1/reminders/plan','GET',undefined,bearer(phone))).json() as {items:unknown[]};
  assert.ok(Array.isArray(plan.items));

  // 配对码：只能由 Web 生成，大小写与分隔符不敏感，单次消费。
  assert.equal((await call('/devices/pairing-codes','POST',undefined,{Cookie:cookie})).status,403,'生成配对码需要 CSRF');
  const {code}=await (await call('/devices/pairing-codes','POST',undefined,web)).json() as {code:string};
  assert.match(code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const paired=await call('/app/v1/auth/pair','POST',{code:code.replace('-','').toLowerCase(),deviceName:'iPad'});assert.equal(paired.status,201);
  const ipad=await paired.json() as DeviceTokens;
  assert.equal((await call('/app/v1/auth/pair','POST',{code,deviceName:'再次使用'})).status,401,'配对码不能重复使用');
  const devices=await (await call('/devices','GET',undefined,{Cookie:cookie})).json() as {id:string;method:string}[];
  assert.deepEqual(devices.map(d=>d.method).sort(),['pairing','password']);
  assert.ok(!JSON.stringify(devices).includes('Hash'),'设备列表不含令牌哈希');

  // 新配对码使旧的未用配对码失效；过期配对码拒绝。
  const first=await (await call('/devices/pairing-codes','POST',undefined,web)).json() as {code:string};
  const second=await (await call('/devices/pairing-codes','POST',undefined,web)).json() as {code:string};
  assert.equal((await call('/app/v1/auth/pair','POST',{code:first.code,deviceName:'旧码'})).status,401);
  const db=app.get(DatabaseService).db;db.prepare('UPDATE pairing_codes SET expiresAt=? WHERE consumedAt IS NULL').run(Date.now()-1);
  assert.equal((await call('/app/v1/auth/pair','POST',{code:second.code,deviceName:'过期'})).status,401);

  // 刷新轮换：旧访问令牌立即失效；重放旧刷新令牌吊销整个会话。
  const rotated=await (await call('/app/v1/auth/refresh','POST',{refreshToken:phone.refreshToken})).json() as DeviceTokens;
  assert.notEqual(rotated.refreshToken,phone.refreshToken);assert.equal(rotated.device.id,phone.device.id);
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(phone))).status,401);
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(rotated))).status,200);
  assert.equal((await call('/app/v1/auth/refresh','POST',{refreshToken:phone.refreshToken})).status,401);
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(rotated))).status,401,'重放旧刷新令牌后会话被吊销');
  assert.equal((await call('/app/v1/auth/refresh','POST',{refreshToken:rotated.refreshToken})).status,401);

  // Web 撤销设备、App 主动注销都立即生效。
  const tablet=await (await call('/app/v1/auth/login','POST',{username:'owner',password:'a-good-password-123',deviceName:'备用机'})).json() as DeviceTokens;
  assert.equal((await call(`/devices/${tablet.device.id}/revoke`,'POST',undefined,web)).status,201);
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(tablet))).status,401);
  assert.equal((await call('/app/v1/auth/logout','POST',undefined,bearer(ipad))).status,200);
  assert.equal((await call('/app/v1/accounts','GET',undefined,bearer(ipad))).status,401);
  assert.equal((await (await call('/devices','GET',undefined,{Cookie:cookie})).json() as unknown[]).length,0);

  // 配对失败按来源累计（上面已有重复、旧码、过期 3 次），满 5 次后拒绝。
  const statuses=[];for(let i=0;i<3;i++) statuses.push((await call('/app/v1/auth/pair','POST',{code:'ZZZZ-ZZZZ',deviceName:'猜测'})).status);
  assert.deepEqual(statuses,[401,401,429]);
 }finally{app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
