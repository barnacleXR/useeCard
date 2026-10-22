import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,trustProxySetting} from '../src/app.js';
import {DatabaseService} from '../src/database.js';

test('TRUST_PROXY 解析：默认信任本机与内网，可关闭或指定跳数与地址',()=>{
 assert.equal(trustProxySetting(undefined),'loopback, linklocal, uniquelocal');
 assert.equal(trustProxySetting(' '),'loopback, linklocal, uniquelocal');
 assert.equal(trustProxySetting('false'),false);assert.equal(trustProxySetting('0'),false);
 assert.equal(trustProxySetting('true'),true);assert.equal(trustProxySetting('2'),2);
 assert.equal(trustProxySetting('10.0.0.0/8'),'10.0.0.0/8');
});

/** 用指定 TRUST_PROXY 启动实例，返回发起登录请求的函数。 */
async function instance(trust:string|undefined){
 const dir=mkdtempSync(join(tmpdir(),'ccm-proxy-'));
 process.env.DATABASE_PATH=join(dir,'test.db');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';
 if(trust===undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY=trust;
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 const login=(password:string,ip?:string,country?:string)=>fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',...(ip?{'X-Forwarded-For':ip}:{}),...(country?{'CF-IPCountry':country}:{})},body:JSON.stringify({username:'owner',password})}).then(r=>r.status);
 const setup=await fetch(url+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
 assert.equal(setup.status,201);
 const db=app.get(DatabaseService).db;
 return {login,db,close:async()=>{await app.close();if(db.open)db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('经反向代理时按访客真实 IP 限流：一个 IP 被锁不影响其他访客',async()=>{
 const {login,db,close}=await instance(undefined);
 try{
  for(let i=0;i<10;i++) assert.equal(await login('wrong-password-123','203.0.113.5'),401);
  assert.equal(await login('wrong-password-123','203.0.113.5'),429,'同一访客超限');
  assert.equal(await login('a-good-password-123','203.0.113.5'),429,'被锁期间正确密码也拒绝');
  assert.equal(await login('wrong-password-123','198.51.100.7'),401,'其他访客不受影响');
  assert.equal(await login('a-good-password-123','198.51.100.7'),201);
  // 多级转发：取最右侧不可信地址（客户端伪造的左侧地址无效）。
  assert.equal(await login('a-good-password-123','203.0.113.5, 198.51.100.8'),201);
  const audit=db.prepare("SELECT ip,source,outcome FROM audit_events WHERE action='auth.login.failed' ORDER BY createdAt LIMIT 1").get() as {ip:string;source:string;outcome:string};
  assert.deepEqual(audit,{ip:'203.0.113.5',source:'web',outcome:'failure'});
 }finally{await close();delete process.env.TRUST_PROXY;}
});

test('TRUST_PROXY=false 时忽略 X-Forwarded-For，所有请求按直连地址计数',async()=>{
 const {login,db,close}=await instance('false');
 try{
  for(let i=0;i<10;i++) assert.equal(await login('wrong-password-123','203.0.113.5'),401);
  assert.equal(await login('wrong-password-123','198.51.100.7'),429,'伪造转发头不能绕过限流');
  const {ip}=db.prepare("SELECT ip FROM audit_events WHERE action='auth.login.failed' LIMIT 1").get() as {ip:string};assert.notEqual(ip,'203.0.113.5');
 }finally{await close();delete process.env.TRUST_PROXY;}
});

test('国家代码只有显式信任且经过代理时才记录',async()=>{
 const {login,db,close}=await instance(undefined);
 try{
  delete process.env.AUDIT_TRUST_COUNTRY_HEADER;
  assert.equal(await login('wrong-password-123','203.0.113.11','JP'),401);
  assert.equal((db.prepare("SELECT location FROM audit_events WHERE action='auth.login.failed' ORDER BY rowid DESC LIMIT 1").get() as {location:string}).location,'');
  process.env.AUDIT_TRUST_COUNTRY_HEADER='true';
  assert.equal(await login('wrong-password-123','203.0.113.12','JP'),401);
  assert.equal((db.prepare("SELECT location FROM audit_events WHERE action='auth.login.failed' ORDER BY rowid DESC LIMIT 1").get() as {location:string}).location,'JP');
 }finally{delete process.env.AUDIT_TRUST_COUNTRY_HEADER;await close();delete process.env.TRUST_PROXY;}
});
