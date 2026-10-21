import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Account, Card} from '@ccm/shared';
import {DatabaseService} from '../src/database.js';
import {LedgerService} from '../src/common/ledger.service.js';
import {SafeFetchService, isPublicAddress, type FetchResult} from '../src/common/safe-fetch.js';
import {AssetsService, iconLinks, sniffImage} from '../src/assets/assets.service.js';
import {AccountsService} from '../src/accounts/accounts.service.js';
import {BanksService} from '../src/banks/banks.service.js';
import {createApp} from '../src/app.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d70000000049454e44ae426082','hex');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;','latin1');
function fixture(fetcher: Pick<SafeFetchService,'get'> = new SafeFetchService()){
  const database=new DatabaseService(':memory:');const owner=randomUUID();const other=randomUUID();
  for(const id of [owner,other]) database.db.prepare('INSERT INTO users(id,username,passwordHash) VALUES(?,?,?)').run(id,id,'unused');
  const ledger=new LedgerService(database);
  return {database,owner,other,assets:new AssetsService(ledger,fetcher as SafeFetchService),accounts:new AccountsService(ledger)};
}
async function serve(handler: Parameters<typeof createServer>[1]){
  const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  return {server,base:`http://127.0.0.1:${(server.address() as AddressInfo).port}`};
}
const close=(server: Server)=>new Promise(r=>server.close(r));

test('图片识别只看文件头；SVG、文本、HTML 一律拒绝',()=>{
  assert.equal(sniffImage(PNG),'image/png');
  assert.equal(sniffImage(Buffer.from([0xff,0xd8,0xff,0xe0,0,0])),'image/jpeg');
  assert.equal(sniffImage(GIF),'image/gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ','latin1')),'image/webp');
  assert.equal(sniffImage(Buffer.from([0,0,1,0,1,0])),'image/x-icon');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),null);
  assert.equal(sniffImage(Buffer.from('<!doctype html>')),null);
});

test('地址校验：拒绝内网、回环、链路本地、CGNAT、IPv6 私有与 IPv4 映射地址',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.20.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fd00::1','fe80::1','::ffff:127.0.0.1','::ffff:10.0.0.1']) assert.equal(isPublicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','203.104.153.1','2001:4860:4860::8888']) assert.equal(isPublicAddress(ip),true,ip);
});

test('安全抓取：默认拦截本机服务与非法网址；放行模式下限制大小、校验类型、跟随重定向并去重',async()=>{
  const {server,base}=await serve((req,res)=>{
    if(req.url==='/logo.png'){res.setHeader('Content-Type','image/png');res.end(PNG);}
    else if(req.url==='/redirect'){res.statusCode=302;res.setHeader('Location','/logo.png');res.end();}
    else if(req.url==='/loop'){res.statusCode=302;res.setHeader('Location','/loop');res.end();}
    else if(req.url==='/big.png'){res.setHeader('Content-Type','image/png');res.end(Buffer.concat([PNG,Buffer.alloc(600*1024)]));}
    else if(req.url==='/fake.png'){res.setHeader('Content-Type','image/png');res.end('<svg/>');}
    else {res.statusCode=404;res.end();}
  });
  const strict=fixture();const loose=fixture(new SafeFetchService(true));
  try{
    await assert.rejects(strict.assets.fromUrl(strict.owner,{url:`${base}/logo.png`}),/默认端口|内网/);
    await assert.rejects(new SafeFetchService().get('http://127.0.0.1/logo.png'),/内网/);
    await assert.rejects(new SafeFetchService().get('http://169.254.169.254/latest/meta-data'),/内网/);
    await assert.rejects(new SafeFetchService().get('file:///etc/passwd'),/http/);
    await assert.rejects(new SafeFetchService().get('https://user:pass@example.com/a.png'),/用户名或密码/);
    const a=await loose.assets.fromUrl(loose.owner,{url:`${base}/logo.png`});
    assert.equal(a.mime,'image/png');assert.equal(a.source,'url');
    const b=await loose.assets.fromUrl(loose.owner,{url:`${base}/redirect`});
    assert.equal(b.id,a.id,'相同内容只存一份');
    await assert.rejects(loose.assets.fromUrl(loose.owner,{url:`${base}/loop`}),/重定向/);
    await assert.rejects(loose.assets.fromUrl(loose.owner,{url:`${base}/big.png`}),/过大|512/);
    await assert.rejects(loose.assets.fromUrl(loose.owner,{url:`${base}/fake.png`}),/只支持/);
    await assert.rejects(loose.assets.fromUrl(loose.owner,{url:`${base}/missing.png`}),/HTTP 404/);
    assert.equal(loose.assets.file(loose.owner,a.id).mime,'image/png');
    assert.throws(()=>loose.assets.file(loose.other,a.id),/不存在/,'不能读取他人图片');
  }finally{strict.database.close();loose.database.close();await close(server);}
});

test('网站图标：优先 apple-touch-icon 与大尺寸，跳过 SVG，页面失败时退回默认路径',async()=>{
  assert.deepEqual(iconLinks(`<link rel="icon" href="/f16.png" sizes="16x16"><link rel='icon' type="image/svg+xml" href="/i.svg"><link href=/t.png rel="apple-touch-icon" sizes="180x180"><link rel="shortcut icon" href="//cdn.example.com/f32.png" sizes="32x32"><link rel="stylesheet" href="/s.css">`,'https://bank.example.jp/top/'),
    ['https://bank.example.jp/t.png','https://cdn.example.com/f32.png','https://bank.example.jp/f16.png']);
  const calls: string[]=[];
  const fake=(routes: Record<string,FetchResult|Error>)=>({get:async(url:string)=>{calls.push(url);const r=routes[url];if(!r||r instanceof Error) throw r??new Error('404');return r;}});
  const ok=(url:string,body:Buffer)=>({url,status:200,contentType:'',body});
  const site=fixture(fake({
    'https://bank.example.jp/':ok('https://bank.example.jp/',Buffer.from('<link rel="apple-touch-icon" href="/broken.png"><link rel="icon" href="/fav.gif">')),
    'https://bank.example.jp/broken.png':ok('https://bank.example.jp/broken.png',Buffer.from('not an image')),
    'https://bank.example.jp/fav.gif':ok('https://bank.example.jp/fav.gif',GIF),
  }));
  const fallback=fixture(fake({'https://other.example.jp/apple-touch-icon.png':ok('https://other.example.jp/apple-touch-icon.png',PNG)}));
  const www=fixture(fake({'https://www.bare.example.jp/':ok('https://www.bare.example.jp/',Buffer.from('<link rel="icon" href="/i.png">')),'https://www.bare.example.jp/i.png':ok('https://www.bare.example.jp/i.png',PNG)}));
  const none=fixture(fake({}));
  try{
    const a=await site.assets.fromSite(site.owner,{domain:'Bank.Example.jp'});
    assert.equal(a.mime,'image/gif');assert.equal(a.source,'site');assert.equal(a.sourceUrl,'https://bank.example.jp/fav.gif');
    assert.deepEqual(calls.slice(0,3),['https://bank.example.jp/','https://bank.example.jp/broken.png','https://bank.example.jp/fav.gif']);
    assert.equal((await fallback.assets.fromSite(fallback.owner,{domain:'other.example.jp'})).mime,'image/png');
    assert.equal((await www.assets.fromSite(www.owner,{domain:'bare.example.jp'})).sourceUrl,'https://www.bare.example.jp/i.png','裸域名不可达时改用 www');
    await assert.rejects(none.assets.fromSite(none.owner,{domain:'nothing.example.jp'}),/没有在 nothing\.example\.jp 找到/);
    await assert.rejects(none.assets.fromSite(none.owner,{domain:'localhost'}),/域名/);
    await assert.rejects(none.assets.fromSite(none.owner,{domain:'http://evil.example.com/x'}),/域名/);
  }finally{site.database.close();fallback.database.close();www.database.close();none.database.close();}
});

test('上传与引用：大小与格式校验；账户/卡片只能引用本人图标；银行代码与卡组织校验',()=>{
  const {database,owner,other,assets,accounts}=fixture();
  try{
    const mine=assets.upload(owner,{dataUrl:`data:image/png;base64,${PNG.toString('base64')}`});
    assert.equal(mine.source,'upload');
    assert.throws(()=>assets.upload(owner,{dataUrl:`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`}),/只支持/);
    assert.throws(()=>assets.upload(owner,{dataUrl:'data:text/html;base64,PGh0bWw+'}),/请上传图片/);
    const theirs=assets.upload(other,{dataUrl:`data:image/gif;base64,${GIF.toString('base64')}`});
    const account=accounts.createAccount(owner,{name:'三井住友',bankCode:'0009',iconAssetId:mine.id}) as unknown as Account;
    assert.equal(account.bankCode,'0009');assert.equal(account.iconAssetId,mine.id);
    assert.throws(()=>accounts.createAccount(owner,{name:'越权',iconAssetId:theirs.id}),/图标不存在/);
    assert.throws(()=>accounts.createAccount(owner,{name:'坏代码',bankCode:'12'}),/4 位/);
    const card=accounts.createCard(owner,{name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'jcb'}) as unknown as Card;
    assert.equal(card.brand,'jcb');assert.equal(card.iconAssetId,null);
    assert.throws(()=>accounts.createCard(owner,{name:'坏品牌',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'paypal'}));
    const edited=accounts.updateCard(owner,card.id,{name:'楽天カード',defaultDebitAccountId:account.id,defaultCurrency:'JPY',brand:'visa',iconAssetId:mine.id,version:1}) as unknown as Card;
    assert.equal(edited.brand,'visa');assert.equal(edited.iconAssetId,mine.id);
    assert.equal((accounts.updateAccount(owner,account.id,{name:'三井住友',iconAssetId:null,version:1}) as unknown as Account).iconAssetId,null);
  }finally{database.close();}
});

test('银行清单：片假名/平假名/罗马字/代码/半角片假名检索，常用行带域名优先',()=>{
  const banks=new BanksService();
  assert.equal(banks.search('みずほ')[0].code,'0001');
  assert.equal(banks.search('ﾐｽﾞﾎ')[0].code,'0001');
  const rakuten=banks.search('rakuten')[0];assert.equal(rakuten.code,'0036');assert.equal(rakuten.domain,'rakuten-bank.co.jp');
  assert.equal(banks.search('0009')[0].name,'三井住友');
  assert.equal(banks.find('9900')?.domain,'jp-bank.japanpost.jp');
  assert.ok(banks.search('信用金庫').length>0||banks.search('しんきん').length>0);
  assert.equal(banks.search('').length,20);assert.ok(banks.search('').slice(0,5).every(b=>b.domain));
});

test('HTTP：上传图标、按 id 读取（私有长缓存、禁止嵌入脚本）、原生令牌同样可读',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ccm-assets-'));process.env.DATABASE_PATH=join(dir,'test.db');process.env.COOKIE_SECURE='false';
  const app=await createApp();await app.listen(0,'127.0.0.1');const url=await app.getUrl();
  try{
    const setup=await fetch(url+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123'})});
    const cookie=setup.headers.get('set-cookie')!.split(';')[0];const {csrf}=await setup.json() as {csrf:string};
    const big={dataUrl:`data:image/png;base64,${Buffer.concat([PNG,Buffer.alloc(300*1024)]).toString('base64')}`};
    const uploaded=await fetch(url+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify(big)});
    assert.equal(uploaded.status,201,'300 KB 图片可经放宽的请求体上传');
    const {id}=await uploaded.json() as {id:string};
    const file=await fetch(`${url}/api/assets/${id}`,{headers:{Cookie:cookie}});
    assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/png');
    assert.match(file.headers.get('cache-control')??'',/private.*immutable/);assert.equal(file.headers.get('content-security-policy'),"default-src 'none'");
    assert.equal((await fetch(`${url}/api/assets/${id}`)).status,401);
    assert.equal((await fetch(url+'/api/accounts',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({name:'x'.repeat(10),note:'y'.repeat(200*1024)})})).status,413,'其他接口仍限制 128 KB');
    const banks=await (await fetch(url+'/api/banks?q=%E3%82%89%E3%81%8F%E3%81%A6%E3%82%93',{headers:{Cookie:cookie}})).json() as {code:string}[];
    assert.equal(banks[0].code,'0036');
    const login=await (await fetch(url+'/api/app/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'a-good-password-123',deviceName:'iPhone'})})).json() as {accessToken:string};
    assert.equal((await fetch(`${url}/api/app/v1/assets/${id}`,{headers:{Authorization:`Bearer ${login.accessToken}`}})).status,200);
  }finally{app.get(DatabaseService).close();await app.close();rmSync(dir,{recursive:true,force:true});}
});
