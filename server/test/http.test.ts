import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import Database from 'better-sqlite3';
test('真实 HTTP 验证初始化、持久化、会话、CSRF 与来源限制',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-http-')); process.env.DATABASE_PATH=join(dir,'test.db');process.env.COOKIE_SECURE='false';
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 const request=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await request('/accounts')).status,401);
  assert.equal((await request('/auth/setup','POST',{username:'owner',password:'a-good-password-123'},{Origin:'https://untrusted.example'})).status,403);
  const login=await request('/auth/setup','POST',{username:'owner',password:'a-good-password-123'});assert.equal(login.status,201);
  const cookie=login.headers.get('set-cookie')!.split(';')[0];const {csrf}=await login.json() as {csrf:string};
  assert.equal((await request('/auth/setup','POST',{username:'owner',password:'a-good-password-123'})).status,409);
  assert.equal((await request('/accounts','POST',{name:'test'},{Cookie:cookie})).status,403);
  const created=await request('/accounts','POST',{name:'test'},{Cookie:cookie,'X-CSRF-Token':csrf});assert.equal(created.status,201);
  assert.equal((await (await request('/accounts','GET',undefined,{Cookie:cookie})).json() as unknown[]).length,1);
  const {id:accountId}=await created.json() as {id:string};
  const page=await request('/bills/search?page=1&pageSize=5&currency=JPY&cardId=','GET',undefined,{Cookie:cookie});assert.equal(page.status,200);
  assert.deepEqual(await page.json(),{items:[],total:0,page:1,pageSize:5});
  assert.equal((await request('/bills/search?pageSize=abc','GET',undefined,{Cookie:cookie})).status,400);
  assert.equal((await request('/accounts/order','POST',{ids:[accountId]},{Cookie:cookie,'X-CSRF-Token':csrf})).status,201);
  const reopened=new DatabaseService(process.env.DATABASE_PATH); assert.equal((reopened.db.prepare('SELECT count(*) AS n FROM bank_accounts').get() as {n:number}).n,1);reopened.close();
  const malformed=await fetch(url+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:'{bad json'});
  assert.equal(malformed.status,400,'JSON 格式错误返回 400 而非 500');
  await request('/auth/logout','POST',undefined,{Cookie:cookie,'X-CSRF-Token':csrf});
  assert.equal((await request('/accounts','GET',undefined,{Cookie:cookie})).status,401);
 }finally{app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('v1 数据库逐级升级到最新：保留数据，补齐版本、备注、显示顺序、设备表与提醒偏好',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ccm-migrate-'));const file=join(dir,'v1.db');
  try{
    const old=new Database(file);
    old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(1);
      CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, defaultCurrency TEXT NOT NULL DEFAULT 'JPY');
      CREATE TABLE bank_accounts(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, bankName TEXT NOT NULL, note TEXT NOT NULL, archivedAt TEXT);
      CREATE TABLE credit_cards(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, issuer TEXT NOT NULL, last4 TEXT NOT NULL, defaultDebitAccountId TEXT NOT NULL REFERENCES bank_accounts(id), defaultCurrency TEXT NOT NULL, frequency TEXT NOT NULL CHECK(frequency IN ('regular','low')), archivedAt TEXT);
      INSERT INTO users VALUES('u','old','x','JPY');INSERT INTO bank_accounts VALUES('a','u','旧账户','','',NULL);INSERT INTO credit_cards VALUES('c','u','旧卡','','','a','JPY','regular',NULL);`);
    old.close();
    const upgraded=new DatabaseService(file);
    try{
      assert.deepEqual(upgraded.db.prepare('SELECT name,note,version,sortOrder FROM credit_cards').get(),{name:'旧卡',note:'',version:1,sortOrder:1});
      assert.equal((upgraded.db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as {v:number}).v,12);
      assert.ok(upgraded.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_keys'").get());
      assert.deepEqual(upgraded.db.prepare('SELECT brand,iconAssetId FROM credit_cards').get(),{brand:'',iconAssetId:null});
      assert.deepEqual(upgraded.db.prepare('SELECT reminderDaysBefore,reminderTime FROM users').get(),{reminderDaysBefore:1,reminderTime:'09:00'});
      assert.ok(upgraded.db.prepare("SELECT value FROM instance_settings WHERE key='instanceId'").get());
      assert.equal(JSON.parse((upgraded.db.prepare("SELECT value FROM instance_settings WHERE key='backupSchedule'").get() as {value:string}).value).frequency,'off','已有实例升级后自动备份保持关闭');
      assert.equal((upgraded.db.prepare('SELECT version FROM bank_accounts').get() as {version:number}).version,1);
    }finally{upgraded.close();}
    new DatabaseService(file).close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('客户端子路由回退到 index.html，部署路径含点目录也可用',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-spa-'));const client=join(dir,'.hidden','dist');mkdirSync(client,{recursive:true});writeFileSync(join(client,'index.html'),'<div id="app"></div>');
 process.env.DATABASE_PATH=join(dir,'test.db');process.env.CLIENT_DIST=client;
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 try{
  for(const path of ['/','/manage','/reviews']){const res=await fetch(url+path);assert.equal(res.status,200,path);assert.match(await res.text(),/id="app"/);}
  assert.equal((await fetch(url+'/api/accounts')).status,401);
 }finally{delete process.env.CLIENT_DIST;app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
