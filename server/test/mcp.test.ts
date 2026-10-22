import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createApp} from '../src/app.js';
import {DatabaseService} from '../src/database.js';
import {BackupService} from '../src/data-management/backup.service.js';
import {legacyFromFile} from './backup-fixture.js';

const RESOURCE='http://localhost:5173/mcp';
const pkce=()=>{const verifier=randomBytes(32).toString('base64url');return {verifier,challenge:createHash('sha256').update(verifier).digest('base64url')};};

test('MCP：OAuth 元数据、动态登记、授权页、PKCE、按权限暴露工具、写入幂等、刷新轮换与重放、撤销、凭证隔离',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-mcp-'));
 process.env.DATABASE_PATH=join(dir,'test.db');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';delete process.env.BASE_URL;
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
 try{
  const call=(path:string,init:RequestInit={})=>fetch(url+path,{redirect:'manual',...init});
  const setup=await call('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};
  const web={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const post=async(path:string,body:unknown,expect=201)=>{const r=await call(path,{method:'POST',headers:web,body:JSON.stringify(body)});assert.equal(r.status,expect,`${path} ${await r.clone().text()}`);return r.json() as Promise<any>;};
  const account=await post('/api/accounts',{name:'三井住友',bankCode:'0009'});
  const rakuten=await post('/api/cards',{name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY'});
  await post('/api/cards',{name:'楽天プレミアムカード',defaultDebitAccountId:account.id,defaultCurrency:'JPY'});
  const amex=await post('/api/cards',{name:'Amex Gold',defaultDebitAccountId:account.id,defaultCurrency:'USD'});

  // 元数据：受保护资源指向授权服务器；授权服务器只支持 S256。
  const prm=await (await call('/.well-known/oauth-protected-resource/mcp')).json() as any;
  assert.equal(prm.resource,RESOURCE);assert.deepEqual(prm.authorization_servers,['http://localhost:5173/']);
  const asm=await (await call('/.well-known/oauth-authorization-server')).json() as any;
  assert.deepEqual(asm.code_challenge_methods_supported,['S256']);assert.ok(asm.scopes_supported.includes('bills:write'));
  const unauth=await call('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{}'});
  assert.equal(unauth.status,401);assert.match(unauth.headers.get('www-authenticate')!,/resource_metadata="http:\/\/localhost:5173\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.equal((await call('/mcp')).status,405,'无状态：不提供 GET 流');

  // 动态登记：危险回调被拒；机密客户端密钥只存哈希。
  const register=(body:unknown)=>call('/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify(body)});
  assert.equal((await register({client_name:'x',redirect_uris:['javascript:alert(1)']})).status,400);
  assert.equal((await register({client_name:'x',redirect_uris:['http://example.com/cb']})).status,400,'非本机 http 回调被拒');
  const reg=await register({client_name:'Claude',redirect_uris:['https://claude.ai/api/mcp/auth_callback'],token_endpoint_auth_method:'client_secret_post'});
  assert.equal(reg.status,201);const client=await reg.json() as any;assert.ok(client.client_secret);
  const stored=app.get(DatabaseService).db.prepare('SELECT secretHash FROM oauth_clients WHERE id=?').get(client.client_id) as any;
  assert.notEqual(stored.secretHash,client.client_secret);assert.equal(stored.secretHash.length,64);
  assert.equal(asm.registration_endpoint,'http://localhost:5173/register');

  // 授权：转到需要登录的授权页；默认只勾选只读。
  const authorize=async(scope:string,challenge:string,state='s1')=>{
   const r=await call(`/authorize?${new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'https://claude.ai/api/mcp/auth_callback',code_challenge:challenge,code_challenge_method:'S256',state,scope,resource:RESOURCE})}`);
   assert.equal(r.status,302);const location=r.headers.get('location')!;assert.match(location,/^\/oauth\/consent\?request=/);return new URL(location,url).searchParams.get('request')!;};
  const p1=pkce();const req1=await authorize('bills:read bills:write summary:read',p1.challenge);
  assert.equal((await call(`/api/oauth/requests/${req1}`)).status,401,'授权页需要 Web 登录');
  const pending=await (await call(`/api/oauth/requests/${req1}`,{headers:{Cookie:cookie}})).json() as any;
  assert.equal(pending.clientName,'Claude');assert.equal(pending.redirectHost,'claude.ai');assert.deepEqual(pending.defaultScopes,['bills:read','summary:read']);
  assert.equal((await call(`/api/oauth/requests/${req1}/approve`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({scopes:['bills:read']})})).status,403,'确认需要 CSRF');
  const approved=await post(`/api/oauth/requests/${req1}/approve`,{scopes:['accounts:read','cards:read','bills:read','summary:read','reviews:read']});
  const back=new URL(approved.redirectUrl);assert.equal(back.searchParams.get('state'),'s1');assert.equal(back.searchParams.get('iss'),'http://localhost:5173');
  const code=back.searchParams.get('code')!;assert.match(code,/^ccmc_/);
  await post(`/api/oauth/requests/${req1}/approve`,{scopes:['bills:read']},404);

  // 换令牌：密钥按哈希校验；PKCE 错误被拒；授权码只能用一次。
  const token=(body:Record<string,string>,headers:Record<string,string>={})=>call('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
  const exchange={grant_type:'authorization_code',code,redirect_uri:'https://claude.ai/api/mcp/auth_callback',client_id:client.client_id,resource:RESOURCE};
  assert.equal((await token({...exchange,code_verifier:p1.verifier})).status,401,'机密客户端必须带密钥');
  assert.equal((await token({...exchange,code_verifier:p1.verifier,client_secret:'wrong'})).status,401);
  assert.equal((await token({...exchange,code_verifier:pkce().verifier,client_secret:client.client_secret})).status,400,'PKCE 校验');
  const basic='Basic '+Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64');
  const {client_id:_omit,...noId}=exchange;const issued=await token({...noId,code_verifier:p1.verifier},{Authorization:basic});
  assert.equal(issued.status,200,await issued.clone().text());const read=await issued.json() as any;
  assert.match(read.access_token,/^ccmo_/);assert.match(read.refresh_token,/^ccmor_/);assert.equal(read.expires_in,3600);
  assert.equal((await token({...exchange,code_verifier:p1.verifier,client_secret:client.client_secret})).status,400,'授权码重放');
  // 重放授权码吊销其签发的授权。
  assert.equal((await call('/mcp',{method:'POST',headers:{Authorization:`Bearer ${read.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})})).status,401);

  // 重新授权：只读与读写两个令牌。
  const grant=async(scopes:string[])=>{const p=pkce();const id=await authorize(scopes.join(' '),p.challenge);const c=new URL((await post(`/api/oauth/requests/${id}/approve`,{scopes})).redirectUrl).searchParams.get('code')!;
   const r=await token({...exchange,code:c,code_verifier:p.verifier,client_secret:client.client_secret});assert.equal(r.status,200);return r.json() as Promise<any>;};
  const reader=await grant(['accounts:read','cards:read','bills:read','summary:read','reviews:read']);
  const writer=await grant(['cards:read','bills:read','bills:write','reviews:read','reviews:write']);
  const connect=async(accessToken:string)=>{const c=new Client({name:'test',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${accessToken}`}}}));return c;};
  const text=(r:any)=>JSON.parse(r.content[0].text);

  const readClient=await connect(reader.access_token);
  assert.match(readClient.getInstructions()!,/不同币种不能相加/);
  const readTools=(await readClient.listTools()).tools.map(t=>t.name).sort();
  assert.deepEqual(readTools,['get_bill','get_funding_summary','get_monthly_review','list_accounts','list_bills','list_cards']);
  assert.ok((await readClient.listTools()).tools.every(t=>t.annotations?.readOnlyHint));
  const denied=await readClient.callTool({name:'create_bill',arguments:{}});assert.equal(denied.isError,true,'只读令牌看不到也调不了写入工具');assert.match(JSON.stringify(denied.content),/not found/);
  assert.equal(text(await readClient.callTool({name:'list_accounts',arguments:{}})).accounts[0].name,'三井住友');

  const writeClient=await connect(writer.access_token);
  const writeTools=(await writeClient.listTools()).tools;
  assert.ok(!writeTools.some(t=>t.name==='list_accounts'||t.name==='get_funding_summary'),'未授权的只读工具也不暴露');
  assert.equal(writeTools.find(t=>t.name==='void_bill')!.annotations!.destructiveHint,true);
  // 卡名歧义返回候选；精确名称命中唯一卡；同一 requestId 不重复录入。
  const ambiguous=await writeClient.callTool({name:'create_bill',arguments:{cardName:'楽天',amountMinor:12000,currency:'JPY',dueDate:'2026-11-27',requestId:randomUUID()}});
  assert.equal(ambiguous.isError,true);assert.equal(text(ambiguous).error,'ambiguous_card');assert.equal(text(ambiguous).candidates.length,2);
  const missing=await writeClient.callTool({name:'create_bill',arguments:{cardName:'楽天カード',amountMinor:12000,currency:'JPY',requestId:randomUUID()}});
  assert.equal(missing.isError,true,'扣款日必填，不推算');
  const requestId=randomUUID();
  const created=text(await writeClient.callTool({name:'create_bill',arguments:{cardName:'楽天カード',amountMinor:12000,currency:'JPY',dueDate:'2026-11-27',requestId}}));
  assert.equal(created.cardId,rakuten.id);assert.equal(created.debitAccountId,account.id);assert.equal(created.status,'pending');
  const again=text(await writeClient.callTool({name:'create_bill',arguments:{cardName:'楽天カード',amountMinor:12000,currency:'JPY',dueDate:'2026-11-27',requestId}}));
  assert.equal(again.id,created.id);
  const usd=text(await writeClient.callTool({name:'create_bill',arguments:{cardId:amex.id,amountMinor:1234,currency:'USD',dueDate:'2026-11-10',requestId:randomUUID()}}));
  // 修改与状态流转：版本冲突返回 conflict。
  const updated=text(await writeClient.callTool({name:'update_bill',arguments:{billId:created.id,version:created.version,amountMinor:13000}}));
  assert.equal(updated.amountMinor,13000);assert.equal(updated.dueDate,'2026-11-27');
  const stale=await writeClient.callTool({name:'mark_bill_paid',arguments:{billId:created.id,version:created.version}});
  assert.equal(text(stale).error,'conflict');
  const paid=text(await writeClient.callTool({name:'mark_bill_paid',arguments:{billId:created.id,version:updated.version}}));assert.equal(paid.status,'paid');
  const undone=text(await writeClient.callTool({name:'undo_bill_paid',arguments:{billId:created.id,version:paid.version}}));assert.equal(undone.status,'pending');
  // 汇总按币种分开，不跨币种相加。
  const summary=text(await readClient.callTool({name:'get_funding_summary',arguments:{dueMonth:'2026-11'}}));
  assert.ok(JSON.stringify(summary).includes('"USD"')&&JSON.stringify(summary).includes('"JPY"'));
  assert.ok(!JSON.stringify(summary).includes('14234'),'不跨币种相加');

  // 月度检查：清单未创建时提示；创建后标记无新增与确认已核对。
  assert.equal(text(await writeClient.callTool({name:'confirm_no_new_bill',arguments:{reviewMonth:'2026-11',cardIds:[amex.id],requestId:randomUUID()}})).error,'review_not_started');
  await post('/api/reviews/2026-11/start',{});
  const review=text(await writeClient.callTool({name:'get_monthly_review',arguments:{reviewMonth:'2026-11'}}));
  const rakutenItem=review.items.find((r:any)=>r.cardId===rakuten.id);
  const reviewed=text(await writeClient.callTool({name:'confirm_reviewed_bills',arguments:{reviewId:rakutenItem.id,billIds:[created.id],version:rakutenItem.version}}));
  assert.equal(reviewed.status,'reviewed');assert.deepEqual(reviewed.billIds,[created.id]);
  const linked=await writeClient.callTool({name:'confirm_no_new_bill',arguments:{reviewMonth:'2026-11',cardIds:[rakuten.id],requestId:randomUUID()}});
  assert.equal(text(linked).error,'linked_bills','已关联账单需显式确认');
  const noNew=text(await writeClient.callTool({name:'confirm_no_new_bill',arguments:{reviewMonth:'2026-11',cardIds:[amex.id],requestId:randomUUID()}}));
  assert.equal(noNew.items[0].status,'no_new');
  const voided=text(await writeClient.callTool({name:'void_bill',arguments:{billId:usd.id,version:usd.version}}));assert.equal(voided.status,'void');

  // 凭证隔离：MCP 令牌不能用于 Web、App、REST；API Key 不能用于 MCP。
  for(const path of ['/api/accounts','/api/app/v1/accounts','/api/v1/accounts']) assert.equal((await call(path,{headers:{Authorization:`Bearer ${reader.access_token}`}})).status,401,path);
  const apiKey=await post('/api/api-keys',{name:'k',scopes:['bills:read']});
  const withKey=await call('/mcp',{method:'POST',headers:{Authorization:`Bearer ${apiKey.key}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(withKey.status,401,'API Key 不能调用 MCP');
  assert.equal((await call('/mcp',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:'{}'})).status,401,'Web Cookie 不能调用 MCP');

  // 刷新：轮换；旧刷新令牌重放会吊销整个授权；刷新不能扩大权限。
  const refresh=(rt:string,extra:Record<string,string>={})=>token({grant_type:'refresh_token',refresh_token:rt,client_id:client.client_id,client_secret:client.client_secret,...extra});
  assert.equal((await refresh(reader.refresh_token,{scope:'bills:write'})).status,400,'刷新不能扩大权限');
  const rotated=await (await refresh(reader.refresh_token)).json() as any;assert.notEqual(rotated.refresh_token,reader.refresh_token);
  assert.equal((await connect(rotated.access_token).then(c=>c.listTools())).tools.length,6);
  assert.equal((await refresh(reader.refresh_token)).status,400,'旧刷新令牌重放');
  assert.equal((await refresh(rotated.refresh_token)).status,400,'重放后整个授权被吊销');
  await assert.rejects(connect(rotated.access_token));

  // 设置页：列出并撤销授权；撤销后令牌立即失效。
  const grants=await (await call('/api/oauth/grants',{headers:{Cookie:cookie}})).json() as any[];
  assert.equal(grants.length,1);assert.equal(grants[0].clientName,'Claude');assert.ok(!JSON.stringify(grants).includes('Hash'));
  await post(`/api/oauth/grants/${grants[0].id}/revoke`,{},201);
  await assert.rejects(writeClient.listTools());
  // 客户端吊销令牌（RFC 7009）与删除客户端。
  const last=await grant(['bills:read']);
  assert.equal((await call('/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:basic},body:new URLSearchParams({token:last.refresh_token})})).status,200);
  assert.equal((await refresh(last.refresh_token)).status,400);
  const manual=await post('/api/oauth/clients',{name:'本地脚本',redirectUris:['http://127.0.0.1:8976/callback'],confidential:true});
  assert.match(manual.clientSecret,/^[0-9a-f]{64}$/);
  const clients=await (await call('/api/oauth/clients',{headers:{Cookie:cookie}})).json() as any[];
  assert.equal(clients.length,2);assert.ok(!JSON.stringify(clients).includes(manual.clientSecret));
  await post(`/api/oauth/clients/${client.client_id}/delete`,{},201);
  assert.equal((await call(`/authorize?${new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'https://claude.ai/api/mcp/auth_callback',code_challenge:pkce().challenge,code_challenge_method:'S256'})}`)).status,400);

  // 恢复备份后所有 MCP 授权失效。
  const fresh=await (async()=>{const c=await post('/api/oauth/clients',{name:'恢复测试',redirectUris:['http://localhost:9999/cb']});
   const p=pkce();const r=await call(`/authorize?${new URLSearchParams({response_type:'code',client_id:c.clientId,redirect_uri:'http://localhost:9999/cb',code_challenge:p.challenge,code_challenge_method:'S256',scope:'bills:read'})}`);
   const id=new URL(r.headers.get('location')!,url).searchParams.get('request')!;const code=new URL((await post(`/api/oauth/requests/${id}/approve`,{scopes:['bills:read']})).redirectUrl).searchParams.get('code')!;
   return (await token({grant_type:'authorization_code',code,code_verifier:p.verifier,redirect_uri:'http://localhost:9999/cb',client_id:c.clientId})).json() as Promise<any>;})();
  assert.equal((await connect(fresh.access_token).then(c=>c.listTools())).tools.map(t=>t.name).sort().join(),'get_bill,list_bills');
  const owner=(app.get(DatabaseService).db.prepare('SELECT id FROM users').get() as any).id;
  const backups=app.get(BackupService);const meta=await backups.create(owner);
  await backups.restore(owner,{password:'a-good-password-123',backup:legacyFromFile(backups.file(meta.id))});
  await assert.rejects(connect(fresh.access_token),'恢复后令牌失效');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
