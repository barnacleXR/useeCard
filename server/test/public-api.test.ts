import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import {BackupService} from '../src/data-management/backup.service.js';
import {OPENAPI_DOCUMENT} from '../src/public-api/openapi.js';
import {legacyFromFile} from './backup-fixture.js';

test('只读 REST API v1：API Key 只显示一次、凭证隔离、scope、撤销与过期、游标分页、限流、恢复后失效、OpenAPI',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-public-api-'));
 process.env.DATABASE_PATH=join(dir,'test.db');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';process.env.CCM_API_RATE_LIMIT='40';
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 const password='a-good-password-123';
 try{
  const call=(path:string,init:RequestInit={})=>fetch(url+path,init);
  const setup=await call('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};
  const web={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const post=async(path:string,body:unknown,expect=201)=>{const r=await call(path,{method:'POST',headers:web,body:JSON.stringify(body)});assert.equal(r.status,expect,`${path} ${await r.clone().text()}`);return r.json() as Promise<any>;};
  const account=await post('/api/accounts',{name:'三井住友',bankCode:'0009'});
  const card=await post('/api/cards',{name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'jcb'});
  const billIds:string[]=[];
  for(let day=1;day<=7;day++){const r=await call('/api/bills',{method:'POST',headers:{...web,'Idempotency-Key':randomUUID()},body:JSON.stringify({cardId:card.id,debitAccountId:account.id,amountMinor:1000*day,currency:day===7?'USD':'JPY',dueDate:`2026-11-0${day}`})});billIds.push((await r.json() as any).id);}
  // 同一扣款日两笔，验证游标按（日期, id）稳定。
  const twin=await (await call('/api/bills',{method:'POST',headers:{...web,'Idempotency-Key':randomUUID()},body:JSON.stringify({cardId:card.id,debitAccountId:account.id,amountMinor:42,currency:'JPY',dueDate:'2026-11-03'})})).json() as any;billIds.push(twin.id);

  // 创建：原文只出现一次，列表只有前缀。
  assert.equal((await call('/api/api-keys',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:'x',scopes:['bills:read']})})).status,403,'创建需要 CSRF');
  await post('/api/api-keys',{name:'空权限',scopes:[]},400);
  await post('/api/api-keys',{name:'写权限',scopes:['bills:write']},400);
  const full=await post('/api/api-keys',{name:'家庭看板',scopes:['accounts:read','cards:read','bills:read','summary:read','reviews:read'],expiresInDays:30});
  assert.match(full.key,/^ccmk_[A-Za-z0-9_-]{40,}$/);assert.equal(full.prefix,full.key.slice(0,12));
  assert.ok(Date.parse(full.expiresAt)-Date.now()>29*86400_000);
  const billsOnly=await post('/api/api-keys',{name:'只读账单',scopes:['bills:read','bills:read'],expiresInDays:null});
  assert.deepEqual(billsOnly.scopes,['bills:read']);assert.equal(billsOnly.expiresAt,null);
  const listed=await (await call('/api/api-keys',{headers:{Cookie:cookie}})).json() as any[];
  assert.equal(listed.length,2);assert.ok(!JSON.stringify(listed).includes(full.key),'列表不含原文');assert.ok(!JSON.stringify(listed).includes('keyHash'));
  const key=(k:any)=>({Authorization:`Bearer ${k.key}`});

  // 凭证隔离与只读。
  assert.equal((await call('/api/v1/accounts')).status,401);
  assert.equal((await call('/api/v1/accounts',{headers:{Cookie:cookie}})).status,401,'Web Cookie 不能调用 v1');
  const device=await (await call('/api/app/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password,deviceName:'iPhone'})})).json() as any;
  assert.equal((await call('/api/v1/accounts',{headers:{Authorization:`Bearer ${device.accessToken}`}})).status,401,'设备令牌不能调用 v1');
  assert.equal((await call('/api/accounts',{headers:key(full)})).status,401,'API Key 不能调用 Web 接口');
  assert.equal((await call('/api/app/v1/accounts',{headers:key(full)})).status,401,'API Key 不能调用原生接口');
  assert.equal((await call('/api/api-keys',{headers:key(full)})).status,401,'API Key 不能管理 Key');
  assert.equal((await call('/api/v1/bills',{method:'POST',headers:key(full)})).status,405);

  // scope：只读账单的 Key 不能读汇总。
  assert.equal((await call('/api/v1/summary?dueMonth=2026-11',{headers:key(billsOnly)})).status,403);
  assert.equal((await call('/api/v1/bills',{headers:key(billsOnly)})).status,200);

  // 对外字段：不含 ownerId 等内部字段。
  const accounts=await (await call('/api/v1/accounts',{headers:key(full)})).json() as any;
  assert.deepEqual(Object.keys(accounts.items[0]).sort(),['archivedAt','bankCode','bankName','id','name']);
  const cards=await (await call('/api/v1/cards',{headers:key(full)})).json() as any;assert.equal(cards.items[0].brand,'jcb');assert.equal(cards.items[0].ownerId,undefined);

  // 游标分页：逐页取完，不重不漏，顺序为（扣款日, id）。
  const seen:any[]=[];let cursor:string|null='';let pages=0;
  do{const q=new URLSearchParams({dueMonth:'2026-11',limit:'3',...(cursor?{cursor}:{})});const page=await (await call(`/api/v1/bills?${q}`,{headers:key(full)})).json() as any;seen.push(...page.items);cursor=page.nextCursor;pages++;}while(cursor);
  assert.equal(pages,3);assert.equal(seen.length,8);assert.equal(new Set(seen.map(b=>b.id)).size,8);
  assert.deepEqual(seen.map(b=>[b.dueDate,b.id]),[...seen].sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)).map(b=>[b.dueDate,b.id]));
  assert.equal(seen[0].ownerId,undefined);assert.equal(typeof seen[0].amountMinor,'number');
  assert.equal(((await (await call('/api/v1/bills?currency=USD',{headers:key(full)})).json()) as any).items.length,1);
  assert.equal(((await (await call('/api/v1/bills?from=2026-11-02&to=2026-11-03',{headers:key(full)})).json()) as any).items.length,3);
  assert.equal((await call('/api/v1/bills?cursor=not-a-cursor',{headers:key(full)})).status,400);
  assert.equal((await call('/api/v1/bills?limit=500',{headers:key(full)})).status,400);
  assert.equal((await call('/api/v1/bills?unknown=1',{headers:key(full)})).status,400);
  assert.equal(((await (await call(`/api/v1/bills/${billIds[0]}`,{headers:key(full)})).json()) as any).amountMinor,1000);
  assert.equal((await call(`/api/v1/bills/${randomUUID()}`,{headers:key(full)})).status,404);

  // 汇总按币种分组，不跨币种相加；检查状态。
  const summary=await (await call('/api/v1/summary?dueMonth=2026-11',{headers:key(full)})).json() as any;
  assert.deepEqual(summary.accounts[0].byCurrency.map((g:any)=>[g.currency,g.pendingTotalMinor]),[['JPY',21042],['USD',7000]]);
  assert.equal(summary.total,undefined);
  assert.equal(((await (await call('/api/v1/summary?dueMonth=2026-11&currency=USD',{headers:key(full)})).json()) as any).accounts[0].byCurrency.length,1);
  await post('/api/reviews/2026-11/start',{});
  const reviews=await (await call('/api/v1/reviews?reviewMonth=2026-11',{headers:key(full)})).json() as any;
  assert.equal(reviews.items[0].status,'unreviewed');assert.equal(reviews.items[0].periodId,undefined);

  // OpenAPI 公开可读，且覆盖全部接口。
  const doc=await (await call('/api/v1/openapi.json')).json() as any;
  assert.equal(doc.openapi,'3.1.0');assert.deepEqual(Object.keys(doc.paths).sort(),Object.keys(OPENAPI_DOCUMENT.paths).sort());
  assert.ok(['/api/v1/accounts','/api/v1/cards','/api/v1/bills','/api/v1/bills/{id}','/api/v1/summary','/api/v1/reviews'].every(p=>doc.paths[p]));

  // 限流：按 Key 计数，超限返回 429 与 Retry-After；其他 Key 不受影响。
  const limiter=await post('/api/api-keys',{name:'限流测试',scopes:['cards:read']});
  const statuses:number[]=[];for(let i=0;i<41;i++) statuses.push((await call('/api/v1/cards',{headers:key(limiter)})).status);
  assert.equal(statuses.filter(s=>s===200).length,40);assert.equal(statuses.at(-1),429);
  const limited=await call('/api/v1/cards',{headers:key(limiter)});assert.ok(Number(limited.headers.get('retry-after'))>=1);
  assert.equal((await call('/api/v1/cards',{headers:key(full)})).status,200);

  // 撤销与过期立即生效。
  await post(`/api/api-keys/${billsOnly.id}/revoke`,{});
  assert.equal((await call('/api/v1/bills',{headers:key(billsOnly)})).status,401);
  await post(`/api/api-keys/${billsOnly.id}/revoke`,{},404);
  app.get(DatabaseService).db.prepare('UPDATE api_keys SET expiresAt=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),limiter.id);
  assert.equal((await call('/api/v1/cards',{headers:key(limiter)})).status,401);

  // 备份恢复后 API Key 全部失效（与会话、设备一致）。
  const owner=(app.get(DatabaseService).db.prepare('SELECT id FROM users').get() as {id:string}).id;
  const backups=app.get(BackupService);const meta=await backups.create(owner);
  await backups.restore(owner,{password,backup:legacyFromFile(backups.file(meta.id))});
  assert.equal((await call('/api/v1/accounts',{headers:key(full)})).status,401);
 }finally{delete process.env.CCM_API_RATE_LIMIT;app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
