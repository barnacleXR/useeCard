import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BadRequestException, Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import webpush from 'web-push';
import { DatabaseService } from '../database.js';
import { LedgerService } from '../common/ledger.service.js';
import { isPublicAddress } from '../common/safe-fetch.js';

// 推送服务端点必须解析到公网地址，避免借推送请求访问服务器所在内网。
async function assertPublicEndpoint(endpoint:string){
  const {hostname}=new URL(endpoint);
  let addresses:{address:string}[];
  try{addresses=await lookup(hostname.replace(/^\[|\]$/g,''),{all:true});}catch{throw new BadRequestException('推送服务地址无法解析');}
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new BadRequestException('推送服务地址必须是公网地址');
}
const MAX_BACKOFF_MS=3600_000;

const subscriptionSchema=z.object({endpoint:z.url().startsWith('https://'),keys:z.object({p256dh:z.string().min(20).max(500),auth:z.string().min(10).max(500)})}).strict();
type Subscription=z.infer<typeof subscriptionSchema>;
@Injectable()
export class PushService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  lastTickAt=Date.now();
  // 投递持续失败（非 404/410）的订阅按指数退避，最长一小时再试。
  private failures=new Map<string,{count:number;retryAt:number}>();
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(LedgerService) private readonly ledger:LedgerService){}
  private get db(){return this.database.db;}
  configured(){return !!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY&&process.env.VAPID_SUBJECT);}
  state(owner:string){return {configured:this.configured(),reason:this.configured()?null:'部署环境未配置 VAPID 密钥',publicKey:process.env.VAPID_PUBLIC_KEY||null,subscriptions:this.db.prepare('SELECT id,endpointHash,createdAt,lastSuccessAt FROM push_subscriptions WHERE userId=? ORDER BY createdAt DESC').all(owner)};}
  private key(){return createHash('sha256').update(process.env.VAPID_PRIVATE_KEY||'').digest();}
  private seal(value:Subscription){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
  private unseal(value:string):Subscription{const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',this.key(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return subscriptionSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString()));}
  async subscribe(owner:string,input:unknown){if(!this.configured())throw new BadRequestException('尚未配置浏览器推送');const sub=subscriptionSchema.parse(input);await assertPublicEndpoint(sub.endpoint);const hash=createHash('sha256').update(sub.endpoint).digest('hex');
    this.db.prepare('INSERT INTO push_subscriptions(id,userId,endpointHash,payload,createdAt) VALUES(?,?,?,?,?) ON CONFLICT(endpointHash) DO UPDATE SET payload=excluded.payload,userId=excluded.userId').run(randomUUID(),owner,hash,this.seal(sub),new Date().toISOString());
    this.ledger.audit(owner,'push.subscribe',owner,{});return this.state(owner);
  }
  unsubscribe(owner:string,id:string){this.db.prepare('DELETE FROM push_subscriptions WHERE id=? AND userId=?').run(id,owner);this.ledger.audit(owner,'push.unsubscribe',id,{});return this.state(owner);}
  private async deliver(payload:string,onlySubscription?:string){if(!this.configured())return false;
    try{webpush.setVapidDetails(process.env.VAPID_SUBJECT!,process.env.VAPID_PUBLIC_KEY!,process.env.VAPID_PRIVATE_KEY!);}catch{return false;}
    let delivered=false;
    const rows=this.db.prepare(`SELECT id,userId,payload FROM push_subscriptions ${onlySubscription?'WHERE id=?':''}`).all(...(onlySubscription?[onlySubscription]:[])) as {id:string;userId:string;payload:string}[];
    for(const row of rows){
      const failure=this.failures.get(row.id);if(failure&&failure.retryAt>Date.now())continue;
      let sub:Subscription;
      // 无法解密（如更换了 VAPID 私钥）的订阅不可能再投递成功，直接删除。
      try{sub=this.unseal(row.payload);}catch{this.db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);this.failures.delete(row.id);continue;}
      try{await assertPublicEndpoint(sub.endpoint);await webpush.sendNotification(sub,payload,{TTL:3600,urgency:'normal'});this.db.prepare('UPDATE push_subscriptions SET lastSuccessAt=? WHERE id=?').run(new Date().toISOString(),row.id);this.failures.delete(row.id);delivered=true;}
      catch(error){const status=(error as {statusCode?:number}).statusCode;
        if(status===404||status===410){this.db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);this.failures.delete(row.id);}
        else{const count=(failure?.count||0)+1;this.failures.set(row.id,{count,retryAt:Date.now()+Math.min(MAX_BACKOFF_MS,60_000*2**(count-1))});}}}
    return delivered;
  }
  async sendSystem(title:string,body:string){await this.deliver(JSON.stringify({title,body,url:'/system'}));}
  async tick(){this.lastTickAt=Date.now();if(!this.configured())return;const rows=this.db.prepare(`SELECT s.id AS subscriptionId,s.userId,n.id AS notificationId,n.version FROM push_subscriptions s JOIN notifications n ON n.ownerId=s.userId
    LEFT JOIN push_deliveries d ON d.subscriptionId=s.id AND d.notificationId=n.id AND d.version=n.version WHERE n.resolvedAt IS NULL AND d.subscriptionId IS NULL LIMIT 50`).all() as {subscriptionId:string;userId:string;notificationId:string;version:number}[];
    for(const row of rows){if(await this.deliver(JSON.stringify({title:'useeCard',body:'有新的提醒，请打开应用查看。',url:'/notifications'}),row.subscriptionId))this.db.prepare('INSERT OR IGNORE INTO push_deliveries VALUES(?,?,?)').run(row.subscriptionId,row.notificationId,row.version);}
  }
  onModuleInit(){this.timer=setInterval(()=>{void this.tick();},60_000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
}
