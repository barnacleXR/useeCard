import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import {BackupService} from '../src/data-management/backup.service.js';
import {SystemService} from '../src/system/system.service.js';
import {PushService} from '../src/notifications/push.service.js';
import {legacyFromArchive} from './backup-fixture.js';

async function fixture(){const dir=mkdtempSync(join(tmpdir(),'useecard-management-'));process.env.DATABASE_PATH=join(dir,'db.sqlite');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';
  const app=await createApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl(),password='a-good-password-123';
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0],{csrf}=await setup.json() as {csrf:string};
  const call=(path:string,method='GET',body?:unknown)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const db=app.get(DatabaseService).db,owner=(db.prepare('SELECT id FROM users').get() as {id:string}).id;
  return {dir,app,base,password,cookie,csrf,call,db,owner,cleanup:async()=>{await app.close();if(db.open)db.close();rmSync(dir,{recursive:true,force:true});delete process.env.BACKUP_DIR;}};
}

test('管理：新会话 30 天滑动，旧会话保留固定到期；失败登录审计可筛选',async()=>{const f=await fixture();try{
  const first=f.db.prepare('SELECT id,expiresAt,rolling FROM sessions').get() as {id:string;expiresAt:number;rolling:number};
  assert.equal(first.rolling,1);assert.ok(first.expiresAt-Date.now()>29*86400_000);
  f.db.prepare('UPDATE sessions SET expiresAt=? WHERE id=?').run(Date.now()+86400_000,first.id);
  const renewed=await f.call('/auth/session');assert.equal(renewed.status,200);assert.ok(renewed.headers.get('set-cookie')?.includes('ccm_session='));
  const next=(f.db.prepare('SELECT expiresAt FROM sessions WHERE id=?').get(first.id) as {expiresAt:number}).expiresAt;assert.ok(next-Date.now()>29*86400_000);
  const fixed=Date.now()+86400_000;f.db.prepare('UPDATE sessions SET rolling=0,expiresAt=? WHERE id=?').run(fixed,first.id);
  await f.call('/auth/session');assert.equal((f.db.prepare('SELECT expiresAt FROM sessions WHERE id=?').get(first.id) as {expiresAt:number}).expiresAt,fixed);
  await f.call('/auth/login','POST',{username:'owner',password:'wrong-password-123'});
  const failures=await (await f.call('/audit?outcome=failure&source=web')).json() as any;
  assert.ok(failures.items.some((v:any)=>v.action==='auth.login.failed'));
 }finally{await f.cleanup();}});

test('管理：告警每日去重、恢复消息状态与个人资料',async()=>{const f=await fixture();try{
  assert.equal((await f.call('/profile','PATCH',{displayName:'管理员',contactEmail:'admin@example.com'})).status,200);
  const profile=await (await f.call('/profile')).json() as any;assert.equal(profile.displayName,'管理员');assert.equal(profile.emailVerified,false);
  const tiny='data:image/png;base64,'+(await sharp({create:{width:4,height:4,channels:4,background:'#aabbcc'}}).png().toBuffer()).toString('base64');
  assert.equal((await f.call('/profile/avatar','POST',{data:tiny})).status,201);
  const avatar=await f.call('/profile/avatar');assert.equal(avatar.headers.get('content-type'),'image/webp');assert.equal(Buffer.from(await avatar.arrayBuffer()).subarray(8,12).toString(),'WEBP');
  const now=Date.now(),insert=f.db.prepare('INSERT INTO audit_events(id,ownerId,action,entityId,changes,createdAt,source,outcome) VALUES(?,?,?,?,?,?,?,?)');
  const oldId=randomUUID();insert.run(oldId,f.owner,'test.expired','expired','{}',new Date(now-181*86400_000).toISOString(),'system','success');
  for(let i=0;i<30;i++)insert.run(randomUUID(),f.owner,'auth.login.failed','owner','{}',new Date(now).toISOString(),'web','failure');
  const system=f.app.get(SystemService);await system.check(now);
  assert.equal(f.db.prepare('SELECT 1 FROM audit_events WHERE id=?').get(oldId),undefined);
  const one=f.db.prepare("SELECT lastSentAt,active FROM system_alerts WHERE key='failed-login'").get() as {lastSentAt:string;active:number};assert.equal(one.active,1);
  await system.check(now+1000);assert.equal((f.db.prepare("SELECT lastSentAt FROM system_alerts WHERE key='failed-login'").get() as {lastSentAt:string}).lastSentAt,one.lastSentAt);
  f.db.prepare("DELETE FROM audit_events WHERE action='auth.login.failed'").run();await system.check(now+2000);
  assert.equal((f.db.prepare("SELECT active FROM system_alerts WHERE key='failed-login'").get() as {active:number}).active,0);
  const backup=f.app.get(BackupService);backup.lastTickAt=now-121_000;assert.ok(system.findings(now).some(v=>v.key==='jobs'));backup.lastTickAt=Date.now();
  backup.saveSchedule(f.owner,{frequency:'weekly',time:'03:00',weekday:0,retentionDays:30});
  f.db.prepare("INSERT INTO instance_settings(key,value) VALUES('backupLastSuccessAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify('2026-10-01T00:00:00.000Z'));
  assert.ok(system.findings(Date.parse('2026-10-25T00:00:00Z')).some(v=>v.key==='backup'));
  const audit=await (await f.call('/audit?outcome=success&source=web&search=profile')).json() as any;assert.ok(audit.items.some((v:any)=>v.action==='profile.update'));
 }finally{await f.cleanup();}});

test('管理：大于 64 MB 的流式归档可恢复，手动备份不会自动清理，分块中断拒绝提交',async()=>{const f=await fixture();try{
  const blob=Buffer.alloc(65*1024*1024,0x5a);
  f.db.prepare('INSERT INTO assets(id,ownerId,mime,size,sha256,data,source,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),f.owner,'image/png',blob.length,'0'.repeat(64),blob,'upload',new Date().toISOString());
  const backup=f.app.get(BackupService),meta=await backup.create(f.owner);assert.ok(meta.bytes>64*1024*1024);assert.ok(statSync(backup.file(meta.id)).size>meta.bytes);
  f.db.prepare('DELETE FROM assets').run();await backup.restoreArchive(f.owner,f.password,backup.file(meta.id));
  assert.equal((f.db.prepare('SELECT count(*) n FROM assets').get() as {n:number}).n,1);
  const upload=backup.startUpload(f.owner,{size:20});
  await assert.rejects(backup.finishUpload(f.owner,upload.id,f.password),/尚未上传完成/);
  await assert.rejects(backup.uploadChunk(f.owner,upload.id,1,(await import('node:stream')).Readable.from([Buffer.from('a')])),/位置不匹配/);
  const manual=backup.list().find(v=>v.id===meta.id);assert.equal(manual?.reason,'manual');
 }finally{await f.cleanup();}});

test('管理：旧 v11 JSON 包在隔离库迁移后恢复，失败不覆盖当前数据',async()=>{const f=await fixture();try{
  const backup=f.app.get(BackupService),meta=await backup.create(f.owner),legacy=legacyFromArchive(readFileSync(backup.file(meta.id))) as any;
  const oldPath=join(f.dir,'old.sqlite');writeFileSync(oldPath,Buffer.from(legacy.databaseBase64,'base64'));
  const old=new Database(oldPath);
  old.exec(`DROP TABLE push_deliveries;DROP TABLE push_subscriptions;DROP TABLE system_alerts;DROP INDEX audit_outcome_date;
    ALTER TABLE audit_events DROP COLUMN location;ALTER TABLE audit_events DROP COLUMN userAgent;ALTER TABLE audit_events DROP COLUMN ip;
    ALTER TABLE audit_events DROP COLUMN authMethod;ALTER TABLE audit_events DROP COLUMN outcome;ALTER TABLE audit_events DROP COLUMN source;
    ALTER TABLE sessions DROP COLUMN rolling;ALTER TABLE users DROP COLUMN avatar;ALTER TABLE users DROP COLUMN contactEmail;ALTER TABLE users DROP COLUMN displayName;
    DELETE FROM schema_migrations WHERE version=12;`);
  const counts=Object.fromEntries((old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]).map(v=>[v.name,(old.prepare(`SELECT count(*) n FROM "${v.name}"`).get() as {n:number}).n]));old.close();
  const bytes=readFileSync(oldPath);legacy.databaseBase64=bytes.toString('base64');legacy.meta={...legacy.meta,schemaVersion:11,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),counts};
  const restored=await backup.restore(f.owner,{password:f.password,backup:legacy});assert.equal(restored.ok,true);
  assert.equal((f.db.prepare('SELECT max(version) v FROM schema_migrations').get() as {v:number}).v,12);
  assert.equal((f.db.prepare('SELECT count(*) n FROM push_subscriptions').get() as {n:number}).n,0);
 }finally{await f.cleanup();}});

test('管理：分块恢复 HTTP 路径、推送订阅密文与离线版本',async()=>{const f=await fixture();try{
  const before=await (await f.call('/offline/snapshot')).json() as any;assert.ok(before.dataEpoch);assert.deepEqual(before.bills,[]);
  process.env.VAPID_PUBLIC_KEY='test-public-key';process.env.VAPID_PRIVATE_KEY='test-private-key';process.env.VAPID_SUBJECT='mailto:test@example.com';
  const keys={p256dh:'a'.repeat(30),auth:'b'.repeat(20)};
  for(const host of ['127.0.0.1','10.0.0.5','[::1]','localhost']) assert.equal((await f.call('/push','POST',{endpoint:`https://${host}/x`,keys})).status,400,`拒绝内网推送地址 ${host}`);
  const sub={endpoint:'https://1.1.1.1/'+randomUUID(),keys};
  const subscribed=await f.call('/push','POST',sub);assert.equal(subscribed.status,201);assert.ok(!JSON.stringify(await subscribed.json()).includes(sub.endpoint));
  const stored=f.db.prepare('SELECT payload FROM push_subscriptions').get() as {payload:string};assert.ok(!stored.payload.includes(sub.endpoint));
  const notificationId=randomUUID(),stamp=new Date().toISOString();
  f.db.prepare('INSERT INTO notifications(id,ownerId,notificationKey,kind,payload,fingerprint,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(notificationId,f.owner,`test:${notificationId}`,'test','{}','test',stamp,stamp);
  await f.app.get(PushService).tick();
  assert.equal((f.db.prepare('SELECT count(*) n FROM push_deliveries').get() as {n:number}).n,0,'发送失败后应保留重试机会');
  delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;delete process.env.VAPID_SUBJECT;
  const backup=f.app.get(BackupService),meta=await backup.create(f.owner),archive=readFileSync(backup.file(meta.id));
  const corrupt=Buffer.from(archive);corrupt[corrupt.length-1]^=1;
  const badStart=await (await f.call('/data/restore-uploads','POST',{size:corrupt.length})).json() as {id:string};
  const badChunk=await fetch(`${f.base}/api/data/restore-uploads/${badStart.id}?offset=0`,{method:'PUT',headers:{Cookie:f.cookie,'X-CSRF-Token':f.csrf,'Content-Type':'application/octet-stream'},body:corrupt});assert.equal(badChunk.status,200);
  const rejected=await f.call(`/data/restore-uploads/${badStart.id}/finish`,'POST',{password:f.password});assert.equal(rejected.status,400);
  assert.equal((await f.call('/profile')).status,200,'损坏归档不得撤销当前登录');
  const started=await f.call('/data/restore-uploads','POST',{size:archive.length});assert.equal(started.status,201);const {id}=await started.json() as {id:string};
  const half=Math.floor(archive.length/2);
  for(const [offset,part] of [[0,archive.subarray(0,half)],[half,archive.subarray(half)]] as const){
    const response=await fetch(`${f.base}/api/data/restore-uploads/${id}?offset=${offset}`,{method:'PUT',headers:{Cookie:f.cookie,'X-CSRF-Token':f.csrf,'Content-Type':'application/octet-stream'},body:part});
    assert.equal(response.status,200,await response.clone().text());
  }
  const finished=await f.call(`/data/restore-uploads/${id}/finish`,'POST',{password:f.password});assert.equal(finished.status,201,await finished.clone().text());
  assert.equal((f.db.prepare('SELECT count(*) n FROM push_subscriptions').get() as {n:number}).n,0);
  const relogin=await f.call('/auth/login','POST',{username:'owner',password:f.password});assert.equal(relogin.status,201);
  const cookie=relogin.headers.get('set-cookie')!.split(';')[0];
  const after=await (await fetch(f.base+'/api/offline/version',{headers:{Cookie:cookie}})).json() as {dataEpoch:string};assert.notEqual(after.dataEpoch,before.dataEpoch);
 }finally{delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;delete process.env.VAPID_SUBJECT;await f.cleanup();}});

test('管理：已有实例保留备份关闭、失败登录不记录输入、头像大请求先校验登录、审计显示金额、失效推送订阅清理',async()=>{const f=await fixture();try{
  // 新实例（迁移时尚无用户）默认每日备份。
  assert.equal(((await (await f.call('/data/backups')).json()) as any).schedule.frequency,'daily');
  // 失败登录只记录用户名是否匹配，不保存输入内容。
  await fetch(f.base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'Typed-Secret-Password-1',password:'wrong-password-123'})});
  const failure=f.db.prepare("SELECT entityId,changes FROM audit_events WHERE action='auth.login.failed' ORDER BY rowid DESC LIMIT 1").get() as {entityId:string;changes:string};
  assert.equal(failure.entityId,'');assert.deepEqual(JSON.parse(failure.changes),{usernameMatched:false});
  assert.ok(!f.db.prepare("SELECT 1 FROM audit_events WHERE entityId LIKE '%Typed-Secret%' OR changes LIKE '%Typed-Secret%'").get());
  // 未登录的大头像请求在解析请求体之前即被拒绝。
  const anonymous=await fetch(f.base+'/api/profile/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:'x'.repeat(9_000_000)})});
  assert.equal(anonymous.status,401);
  // 审计详情保留金额、扣款日与备注。
  const account=await (await f.call('/accounts','POST',{name:'三井住友',bankCode:'0009'})).json() as {id:string};
  const card=await (await f.call('/cards','POST',{name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY'})).json() as {id:string};
  const bill=await fetch(f.base+'/api/bills',{method:'POST',headers:{'Content-Type':'application/json',Cookie:f.cookie,'X-CSRF-Token':f.csrf,'Idempotency-Key':randomUUID()},body:JSON.stringify({cardId:card.id,debitAccountId:account.id,amountMinor:12345,currency:'JPY',dueDate:'2026-11-27',note:'备注内容'})});
  assert.equal(bill.status,201);
  const audited=await (await f.call('/audit?action=bill.create')).json() as any;
  assert.equal(audited.items[0].changes.amountMinor,12345);assert.equal(audited.items[0].changes.dueDate,'2026-11-27');assert.equal(audited.items[0].changes.note,'备注内容');
  // 更换 VAPID 私钥后无法解密的订阅被删除，不会无限重试。
  const webpush=(await import('web-push')).default,first=webpush.generateVAPIDKeys(),second=webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY=first.publicKey;process.env.VAPID_PRIVATE_KEY=first.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';
  assert.equal((await f.call('/push','POST',{endpoint:'https://1.1.1.1/'+randomUUID(),keys:{p256dh:'a'.repeat(30),auth:'b'.repeat(20)}})).status,201);
  process.env.VAPID_PUBLIC_KEY=second.publicKey;process.env.VAPID_PRIVATE_KEY=second.privateKey;
  await f.app.get(PushService).sendSystem('测试','测试');
  assert.equal((f.db.prepare('SELECT count(*) n FROM push_subscriptions').get() as {n:number}).n,0);
 }finally{delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;delete process.env.VAPID_SUBJECT;await f.cleanup();}});
