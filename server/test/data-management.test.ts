import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import {BackupService} from '../src/data-management/backup.service.js';
import {ExportService} from '../src/data-management/export.service.js';
import {MaintenanceService} from '../src/data-management/maintenance.service.js';
import {LedgerService} from '../src/common/ledger.service.js';

const password='test-password-123456';
async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'ccm-backup-'));
  process.env.DATABASE_PATH=join(dir,'live.db');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';
  const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
  const setup=await fetch(url+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};
  const request=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const account=await (await request('/accounts','POST',{name:'=SUM(A1)',bankName:'銀行',note:'备注'})).json() as {id:string};
  const card=await (await request('/cards','POST',{name:'多币种卡',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'jcb'})).json() as {id:string};
  const input={cardId:card.id,debitAccountId:account.id,amountMinor:1234,currency:'USD',dueDate:'2026-11-01',note:'"备注",\n换行'};
  await request('/bills','POST',input,{'Idempotency-Key':randomUUID()});
  await request('/bills','POST',{...input,currency:'JPY',amountMinor:500}, {'Idempotency-Key':randomUUID()});
  await request('/reviews/2026-10/start','POST',{});
  const db=app.get(DatabaseService).db;const owner=(db.prepare('SELECT id FROM users').get() as {id:string}).id;
  const cleanup=async()=>{await app.close();if(db.open)db.close();rmSync(dir,{recursive:true,force:true});delete process.env.BACKUP_DIR;};
  return {dir,app,url,cookie,csrf,request,account,card,input,owner,db,cleanup};
}

test('业务 JSON/CSV：币种与精度、图标/检查导出完整，排除认证材料并转义公式与换行',async()=>{
  const f=await fixture();try{
    const asset=await (await f.request('/assets','POST',{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='})).json() as {id:string};
    await f.request('/accounts/'+f.account.id,'PATCH',{name:'=SUM(A1)',bankName:'銀行',iconAssetId:asset.id,version:1});
    const response=await f.request('/data/export.json');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition')!,/attachment/);
    const data=await response.json() as any;
    assert.equal(data.bills.length,2);assert.deepEqual(data.bills.map((b:any)=>[b.currency,b.amountMinor]),[['USD',1234],['JPY',500]]);
    assert.equal(data.assets.length,1);assert.equal(data.accounts[0].iconAssetId,data.assets[0].id);assert.equal(data.reviews.length,1);
    const text=JSON.stringify(data);for(const key of ['passwordHash','tokenHash','accessHash','refreshHash','csrf','idempotency'])assert.ok(!text.includes('"'+key+'"'));
    const csv=await (await f.request('/data/bills.csv')).text();assert.match(csv,/'=SUM\(A1\)/);assert.match(csv,/"USD","1234","12.34"/);assert.match(csv,/"JPY","500","500"/);assert.match(csv,/""备注"",\n换行/);
    const denied=await fetch(f.url+'/api/data/export.json');assert.equal(denied.status,401);
  }finally{await f.cleanup();}
});

test('完整备份：在线快照包含 WAL；恢复保留金额/图标/检查，撤销所有旧凭证并保存恢复前快照',async()=>{
  const f=await fixture();try{
    const login=await (await f.request('/app/v1/auth/login','POST',{username:'owner',password,deviceName:'测试设备'})).json() as {accessToken:string;refreshToken:string};
    assert.equal((await f.request('/devices/pairing-codes','POST',{})).status,201);
    const asset=await (await f.request('/assets','POST',{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='})).json() as {id:string};
    await f.request('/accounts/'+f.account.id,'PATCH',{name:'银行账户',iconAssetId:asset.id,version:1});
    await f.request('/notification-channels','POST',{name:'备份通知通道',service:'telegram',url:'tgram://123456:TEST_TOKEN/987',enabled:true});
    const notification=await (await f.request('/notifications/test','POST',{})).json() as {id:string};
    await f.request('/notifications/read','POST',{items:[{id:notification.id,version:1}]});
    const created=await f.request('/data/backups','POST',{});assert.equal(created.status,201);const meta=await created.json() as {id:string};
    const backup=await (await f.request('/data/backups/'+meta.id)).json() as any;assert.equal(backup.meta.counts.bills,2);assert.equal(backup.meta.counts.sessions,1);
    await f.request('/bills','POST',{...f.input,amountMinor:999},{'Idempotency-Key':randomUUID()});
    const failed=await f.request('/data/restore','POST',{backup,password:'wrong'});assert.equal(failed.status,401);assert.equal((f.db.prepare('SELECT count(*) AS n FROM bills').get() as any).n,3);
    const restored=await f.request('/data/restore','POST',{backup,password});assert.equal(restored.status,201,await restored.clone().text());const result=await restored.json() as {safetyBackup:string};
    assert.ok(result.safetyBackup);assert.equal((f.db.prepare('SELECT count(*) AS n FROM bills').get() as any).n,2);assert.equal((f.db.prepare('SELECT count(*) AS n FROM card_reviews').get() as any).n,1);
    assert.equal((f.db.prepare('SELECT iconAssetId FROM bank_accounts').get() as any).iconAssetId,asset.id);
    assert.ok(Buffer.isBuffer((f.db.prepare('SELECT data FROM assets').get() as any).data));
    for(const table of ['sessions','device_sessions','pairing_codes'])assert.equal((f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n,0);
    assert.equal((f.db.prepare('SELECT enabled FROM notification_channels').get() as any).enabled,0,'恢复后外部通道默认停用');
    assert.ok((f.db.prepare('SELECT readAt FROM notifications WHERE id=?').get(notification.id) as any).readAt,'通知已读状态随备份保留');
    assert.equal((await f.request('/accounts')).status,401);
    assert.equal((await fetch(f.url+'/api/app/v1/accounts',{headers:{Authorization:'Bearer '+login.accessToken}})).status,401);
    const safety=JSON.parse(readFileSync(join(f.dir,'backups',result.safetyBackup),'utf8'));assert.equal(safety.meta.counts.bills,3);
    const relogin=await f.request('/auth/login','POST',{username:'owner',password});assert.equal(relogin.status,201);
    assert.equal(f.app.get(BackupService).schedule().frequency,'off');assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
  }finally{await f.cleanup();}
});

test('恢复校验：损坏、跨版本、篡改结构/数量拒绝；事务中途失败回滚当前数据',async()=>{
  const f=await fixture();try{
    const service=f.app.get(BackupService);const meta=await service.create(f.owner);const backup=JSON.parse(readFileSync(service.file(meta.id),'utf8'));
    await assert.rejects(service.restore(f.owner,{password,backup:{...backup,meta:{...backup.meta,sha256:'0'.repeat(64)}}}),/校验和/);
    await assert.rejects(service.restore(f.owner,{password,backup:{...backup,meta:{...backup.meta,schemaVersion:999}}}),/版本/);
    await assert.rejects(service.restore(f.owner,{password,backup:{...backup,meta:{...backup.meta,counts:{...backup.meta.counts,bills:999}}}}),/数量/);
    const altered=join(f.dir,'altered.sqlite');writeFileSync(altered,Buffer.from(backup.databaseBase64,'base64'));const db=new Database(altered);db.exec('CREATE TABLE unexpected(value TEXT)');db.close();const bytes=readFileSync(altered);
    await assert.rejects(service.restore(f.owner,{password,backup:{...backup,databaseBase64:bytes.toString('base64'),meta:{...backup.meta,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}}),/结构/);
    await f.request('/bills','POST',{...f.input,amountMinor:999},{'Idempotency-Key':randomUUID()});
    const ledger=f.app.get(LedgerService),audit=ledger.audit.bind(ledger);
    ledger.audit=(...args:Parameters<typeof audit>)=>{if(args[1]==='backup.restore')throw new Error('注入事务失败');audit(...args);};
    await assert.rejects(service.restore(f.owner,{password,backup}),/保持原状/);
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM bills').get() as any).n,3);assert.equal((await f.request('/accounts')).status,200);assert.equal(f.app.get(MaintenanceService).restoring,false);
  }finally{await f.cleanup();}
});

test('自动备份：日本时间调度、每日/每周、重启去重、保留期限与维护门禁',async()=>{
  const f=await fixture();try{
    const b=f.app.get(BackupService),m=f.app.get(MaintenanceService);
    b.saveSchedule(f.owner,{frequency:'daily',time:'03:00',weekday:0,retentionDays:7});
    await b.tick(new Date('2026-10-21T17:59:00Z'));assert.equal(b.list().length,0);
    await b.tick(new Date('2026-10-21T18:00:00Z'));assert.equal(b.list().length,1);
    await b.tick(new Date('2026-10-21T19:00:00Z'));assert.equal(b.list().length,1);
    const second=new BackupService(f.app.get(LedgerService),m,f.app.get((await import('../src/auth/auth.service.js')).AuthService));
    await second.tick(new Date('2026-10-21T20:00:00Z'));assert.equal(b.list().length,1);
    b.saveSchedule(f.owner,{frequency:'weekly',time:'03:00',weekday:0,retentionDays:7});
    await b.tick(new Date('2026-10-23T18:00:00Z'));assert.equal(b.list().length,1);
    const first=b.list()[0];first.createdAt='2020-01-01T00:00:00.000Z';
    writeFileSync(join(f.dir,'backups',first.id+'.meta'),JSON.stringify(first));
    await b.tick(new Date('2026-10-24T18:00:00Z'));assert.equal(b.list().length,1,'自动备份成功后移除超期快照');
    await m.enter();const response=await f.request('/accounts');assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'5');m.leave();assert.equal((await f.request('/accounts')).status,200);
    assert.throws(()=>b.file('../live.db'),/不存在/);
    assert.equal((await f.request('/data/backups','POST',{}, {'X-CSRF-Token':'wrong'})).status,403);
  }finally{await f.cleanup();}
});

test('完整备份可恢复到另一个干净实例，使用备份中的管理员登录',async()=>{
  const first=await fixture();let backup:any;let originalInstance:string;
  try{const b=first.app.get(BackupService),meta=await b.create(first.owner);backup=JSON.parse(readFileSync(b.file(meta.id),'utf8'));originalInstance=(first.db.prepare("SELECT value FROM instance_settings WHERE key='instanceId'").get() as any).value;}finally{await first.cleanup();}
  const fresh=await fixture();try{
    fresh.db.prepare('DELETE FROM review_bill_links').run();fresh.db.prepare('DELETE FROM card_reviews').run();fresh.db.prepare('DELETE FROM review_periods').run();fresh.db.prepare('DELETE FROM bills').run();fresh.db.prepare('DELETE FROM credit_cards').run();fresh.db.prepare('DELETE FROM bank_accounts').run();
    const res=await fresh.request('/data/restore','POST',{password,backup});assert.equal(res.status,201,await res.clone().text());
    assert.equal((fresh.db.prepare('SELECT count(*) AS n FROM bills').get() as any).n,2);
    assert.equal((fresh.db.prepare("SELECT value FROM instance_settings WHERE key='instanceId'").get() as any).value,originalInstance!);
    assert.equal((await fresh.request('/auth/login','POST',{username:'owner',password})).status,201);
  }finally{await fresh.cleanup();}
});
