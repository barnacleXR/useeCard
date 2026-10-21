import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
import {createApp} from '../src/app.js';
import {readOidcConfig} from '../src/oidc/oidc.config.js';

/** 最小的 OIDC 提供方：发现文档、JWKS、授权码 + PKCE 换取签名的 id_token。 */
async function provider(){
 const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'k1',alg:'RS256',use:'sig'};
 const codes=new Map<string,{nonce:string;challenge:string;clientId:string;redirectUri:string}>();
 const opts={sub:'user-1',aud:'',nonce:undefined as string|undefined,issuer:undefined as string|undefined,discoveryIssuer:undefined as string|undefined};
 let issuer='';
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,issuer);const json=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/.well-known/openid-configuration') return json(200,{issuer:opts.discoveryIssuer??issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks'});
  if(url.pathname==='/jwks') return json(200,{keys:[jwk]});
  if(url.pathname==='/token'&&req.method==='POST'){
   let raw='';for await(const chunk of req) raw+=chunk;const form=new URLSearchParams(raw);const entry=codes.get(form.get('code')!);codes.delete(form.get('code')!);
   if(!entry||entry.redirectUri!==form.get('redirect_uri')||entry.clientId!==form.get('client_id')) return json(400,{error:'invalid_grant'});
   if(createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==entry.challenge) return json(400,{error:'invalid_grant'});
   const idToken=await new SignJWT({nonce:opts.nonce??entry.nonce,email:'owner@example.com',email_verified:true}).setProtectedHeader({alg:'RS256',kid:'k1'})
    .setIssuer(opts.issuer??issuer).setAudience(opts.aud||entry.clientId).setSubject(opts.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
   return json(200,{access_token:'x',token_type:'Bearer',id_token:idToken});
  }
  json(404,{});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));issuer=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 /** 模拟用户在提供方完成登录：校验授权请求参数并签发授权码。 */
 const authorize=(location:string)=>{const u=new URL(location);assert.equal(u.origin+u.pathname,issuer+'/authorize');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  const code=randomBytes(8).toString('hex');codes.set(code,{nonce:u.searchParams.get('nonce')!,challenge:u.searchParams.get('code_challenge')!,clientId:u.searchParams.get('client_id')!,redirectUri:u.searchParams.get('redirect_uri')!});
  return {code,state:u.searchParams.get('state')!,redirectUri:u.searchParams.get('redirect_uri')!};};
 return {get issuer(){return issuer;},opts,authorize,close:()=>server.close()};
}

test('OIDC 配置解析：未配置为关闭、不完整或有误时关闭并说明原因',()=>{
 assert.deepEqual(readOidcConfig({}),{on:false});
 assert.match((readOidcConfig({OIDC_CLIENT_ID:'ccm'}) as any).error,/OIDC_ISSUER/);
 const base={OIDC_ISSUER:'https://id.example.com',OIDC_CLIENT_ID:'ccm',BASE_URL:'https://card.example.com'};
 assert.match((readOidcConfig({...base,OIDC_ISSUER:'https://id.example.com/'}) as any).error,/结尾/);
 assert.match((readOidcConfig({...base,OIDC_ISSUER:'http://id.example.com'}) as any).error,/https/);
 assert.match((readOidcConfig({...base,BASE_URL:''}) as any).error,/BASE_URL/);
 assert.match((readOidcConfig({...base,OIDC_SCOPES:'profile'}) as any).error,/openid/);
 assert.match((readOidcConfig({...base,OIDC_REDIRECT_URI:'https://evil.example.com/cb'}) as any).error,/同源/);
 assert.match((readOidcConfig({...base,OIDC_CLIENT_SECRET:'top-secret',OIDC_ISSUER:'ftp://x'}) as any).error,/https/);
 assert.ok(!JSON.stringify(readOidcConfig({...base,OIDC_CLIENT_SECRET:'top-secret',OIDC_SCOPES:'profile'})).includes('top-secret'));
 const on=readOidcConfig({...base,OIDC_CLIENT_SECRET:'s'}) as any;
 assert.equal(on.config.redirectUri,'https://card.example.com/api/auth/oidc/callback');assert.equal(on.config.name,'id.example.com');
});

test('OIDC 登录：先绑定再登录、state 与 Cookie 绑定且一次性、nonce/aud/issuer 校验、未绑定拒绝、解除绑定',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ccm-oidc-'));const idp=await provider();
 for(const key of Object.keys(process.env)) if(key.startsWith('OIDC_')) delete process.env[key];
 process.env.DATABASE_PATH=join(dir,'test.db');process.env.BACKUP_DIR=join(dir,'backups');process.env.COOKIE_SECURE='false';
 const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();process.env.BASE_URL=url;
 const warn=console.warn;console.warn=()=>{};
 try{
  const call=(path:string,init:RequestInit={})=>fetch(path.startsWith('http')?path:url+path,{redirect:'manual',...init});
  const setup=await call('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
  const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};
  const identity=async()=>(await call('/api/auth/oidc/identity',{headers:{Cookie:cookie}})).json() as Promise<any>;

  // 未配置：不出现登录入口，发起登录返回 misconfigured。
  assert.equal(((await (await call('/api/auth/status')).json()) as any).oidc,undefined);
  assert.equal((await call('/api/auth/oidc/start')).headers.get('location'),'/#oidc-error=misconfigured');
  assert.deepEqual(await identity(),{configured:false,name:null,configError:null,redirectUri:null,identity:null});
  process.env.OIDC_CLIENT_ID='ccm';process.env.OIDC_ISSUER=idp.issuer+'/';assert.match((await identity()).configError,/结尾/);
  process.env.OIDC_ISSUER=idp.issuer;process.env.OIDC_CLIENT_ID='ccm';process.env.OIDC_NAME='Pocket ID';
  assert.equal((await identity()).redirectUri,url+'/api/auth/oidc/callback');
  assert.equal(((await (await call('/api/auth/status')).json()) as any).oidc,undefined,'尚无绑定身份时不显示登录按钮');

  /** 发起登录，返回提供方签发的回调地址与 state Cookie。 */
  const begin=async(start:()=>Promise<Response>,locationOf:(r:Response)=>Promise<string>)=>{
   const r=await start();const stateCookie=r.headers.get('set-cookie')!.split(';')[0];assert.match(stateCookie,/^ccm_oidc_state=/);
   assert.match(r.headers.get('set-cookie')!,/SameSite=Lax/);assert.match(r.headers.get('set-cookie')!,/HttpOnly/);
   const {code,state,redirectUri}=idp.authorize(await locationOf(r));return {callback:`${redirectUri}?code=${code}&state=${state}`,stateCookie};};
  const loginFlow=()=>begin(()=>call('/api/auth/oidc/start'),async r=>{assert.equal(r.status,302);return r.headers.get('location')!;});
  const linkFlow=()=>begin(()=>call('/api/auth/oidc/link',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf}}),async r=>{assert.equal(r.status,201);return ((await r.json()) as any).url;});
  const finish=(flow:{callback:string;stateCookie:string},extra='')=>call(flow.callback,{headers:{Cookie:flow.stateCookie+extra}});

  // 未绑定的身份不能登录，也不会创建账号。
  const unlinked=await finish(await loginFlow());assert.equal(unlinked.headers.get('location'),'/#oidc-error=not-linked');
  assert.equal((await call('/api/auth/oidc/link',{method:'POST',headers:{Cookie:cookie}})).status,403,'绑定需要 CSRF');

  // 绑定：回调不携带 SameSite=Strict 的会话 Cookie，靠发起时记录的会话完成绑定。
  const link=await linkFlow();const linked=await finish(link);
  assert.equal(linked.headers.get('location'),'/settings#oidc-link=ok');assert.match(linked.headers.get('set-cookie')!,/ccm_oidc_state=;/,'回调清除 state Cookie');
  const info=await identity();assert.equal(info.identity.email,'owner@example.com');assert.equal(info.identity.lastLoginAt,null);
  assert.deepEqual(((await (await call('/api/auth/status')).json()) as any).oidc,{name:'Pocket ID'});
  assert.equal((await finish(link)).headers.get('location'),'/#oidc-error=state-invalid','回调不能重放');

  // 登录成功：签发会话 Cookie。
  const ok=await finish(await loginFlow());assert.equal(ok.headers.get('location'),'/');
  const session=ok.headers.get('set-cookie')!.split(',').map(s=>s.trim()).find(s=>s.startsWith('ccm_session='))!.split(';')[0];
  assert.equal((await call('/api/auth/session',{headers:{Cookie:session}})).status,200);
  assert.ok((await identity()).identity.lastLoginAt);

  // state 必须与发起登录的浏览器 Cookie 一致。
  const flow=await loginFlow();
  assert.equal((await call(flow.callback)).headers.get('location'),'/#oidc-error=state-invalid','缺少 state Cookie');
  const other=await loginFlow();
  assert.equal((await call(other.callback,{headers:{Cookie:flow.stateCookie}})).headers.get('location'),'/#oidc-error=state-invalid','state Cookie 属于另一次登录');
  assert.equal((await finish(other,'; '+flow.stateCookie)).headers.get('location'),'/#oidc-error=state-invalid','多个 state Cookie');
  assert.equal((await call(`${url}/api/auth/oidc/callback?error=access_denied&state=x`)).headers.get('location'),'/#oidc-error=state-invalid');
  const refused=await loginFlow();
  assert.equal((await call(refused.callback.replace(/code=[^&]+/,'error=access_denied'),{headers:{Cookie:refused.stateCookie}})).headers.get('location'),'/#oidc-error=provider-refused');

  // id_token 校验：nonce、audience、issuer。
  idp.opts.nonce='wrong';assert.equal((await finish(await loginFlow())).headers.get('location'),'/#oidc-error=token-invalid');idp.opts.nonce=undefined;
  idp.opts.aud='another-client';assert.equal((await finish(await loginFlow())).headers.get('location'),'/#oidc-error=token-invalid');idp.opts.aud='';
  idp.opts.issuer='https://evil.example.com';assert.equal((await finish(await loginFlow())).headers.get('location'),'/#oidc-error=token-invalid');idp.opts.issuer=undefined;
  // PKCE：code_verifier 与发起时不符，提供方拒绝。
  const pkce=await loginFlow();const tampered=await loginFlow();
  assert.equal((await call(pkce.callback.replace(/state=.*/,`state=${new URL(tampered.callback).searchParams.get('state')}`),{headers:{Cookie:tampered.stateCookie}})).headers.get('location'),'/#oidc-error=token-invalid');

  // 绑定期间退出登录：绑定失败。
  const ending=await linkFlow();
  const second=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
  const cookie2=second.headers.get('set-cookie')!.split(';')[0];
  await call('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf}});
  assert.equal((await finish(ending)).headers.get('location'),'/settings#oidc-link=session-ended');

  // 解除绑定后不能再用该身份登录。
  const csrf2=((await (await call('/api/auth/session',{headers:{Cookie:cookie2}})).json()) as any).csrf;
  assert.equal((await call('/api/auth/oidc/unlink',{method:'POST',headers:{Cookie:cookie2,'X-CSRF-Token':csrf2}})).status,201);
  assert.equal((await finish(await loginFlow())).headers.get('location'),'/#oidc-error=not-linked');
  assert.equal(((await (await call('/api/auth/status')).json()) as any).oidc,undefined);

  // 发现文档的 issuer 与配置不一致：拒绝发起。
  idp.opts.discoveryIssuer='https://other.example.com';process.env.OIDC_ISSUER=idp.issuer.replace('127.0.0.1','localhost');
  assert.equal((await call('/api/auth/oidc/start')).headers.get('location'),'/#oidc-error=misconfigured');
 }finally{console.warn=warn;for(const key of Object.keys(process.env)) if(key.startsWith('OIDC_')) delete process.env[key];delete process.env.BASE_URL;await app.close();idp.close();rmSync(dir,{recursive:true,force:true});}
});
