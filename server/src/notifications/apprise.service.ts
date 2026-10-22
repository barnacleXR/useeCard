import { randomUUID } from 'node:crypto';
import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { formatMoney, type NotificationItem } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { MaintenanceService } from '../data-management/maintenance.service.js';
import { NotificationsService } from './notifications.service.js';
const services=['telegram','email','discord','bark','ntfy','custom'] as const;
const urlSchema=z.string().trim().min(1).max(2000).refine(v=>/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)&&!/[\r\n,]/.test(v)&&!/^file:/i.test(v),'请填写一个完整的 Apprise 通知地址');
const channelInput=z.object({name:z.string().trim().min(1).max(100),service:z.enum(services),url:urlSchema,enabled:z.boolean().default(false)}).strict();
type Channel={id:string;ownerId:string;name:string;service:string;url:string;enabled:number;version:number;createdAt:string;archivedAt:string|null};
type Delivery={id:string;ownerId:string;channelId:string;notificationId:string|null;notificationVersion:number|null;status:string;attempts:number};
@Injectable()
export class AppriseService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;private running?:Promise<void>;private stopping=false;
  lastTickAt=Date.now();
  constructor(@Inject(LedgerService) private readonly ledger:LedgerService,@Inject(NotificationsService) private readonly notifications:NotificationsService,@Inject(MaintenanceService) private readonly maintenance:MaintenanceService){}
  private get db(){return this.ledger.db;}
  private endpoint(){
    const raw=process.env.APPRISE_API_URL;
    if(!raw)throw new ServiceUnavailableException('尚未启用 Apprise 服务，请按部署说明配置 APPRISE_API_URL');
    let url:URL;try{url=new URL(raw);}catch{throw new ServiceUnavailableException('Apprise 服务地址配置无效');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new ServiceUnavailableException('Apprise 服务地址配置无效');
    return url.toString();
  }
  onModuleInit(){this.timer=setInterval(()=>{void this.run();},30_000);this.timer.unref();}
  async onModuleDestroy(){this.stopping=true;if(this.timer)clearInterval(this.timer);await this.running;}
  state(owner:string){
    const channels=this.db.prepare('SELECT id,name,service,enabled,version,createdAt FROM notification_channels WHERE ownerId=? AND archivedAt IS NULL ORDER BY createdAt,id').all(owner) as Omit<Channel,'url'>[];
    const deliveries=this.db.prepare(`SELECT d.id,d.notificationId,d.status,d.attempts,d.nextAttemptAt,d.lastError,d.createdAt,d.updatedAt,c.name AS channelName
      FROM notification_deliveries d JOIN notification_channels c ON c.id=d.channelId WHERE d.ownerId=? ORDER BY d.createdAt DESC,d.id DESC LIMIT 50`).all(owner);
    return {gatewayConfigured:!!process.env.APPRISE_API_URL,channels:channels.map(row=>({...row,enabled:!!row.enabled})),deliveries};
  }
  create(owner:string,body:unknown){
    const input=channelInput.parse(body);
    if(input.service==='telegram'&&!input.url.startsWith('tgram://'))throw new BadRequestException('Telegram 地址须使用 tgram://');
    if(input.service==='email'&&!/^mailtos?:\/\//.test(input.url))throw new BadRequestException('邮件地址须使用 mailto:// 或 mailtos://');
    if(input.service==='discord'&&!/^discords?:\/\//.test(input.url))throw new BadRequestException('Discord 地址须使用 discord://');
    this.db.transaction(()=>{
      const count=(this.db.prepare('SELECT count(*) n FROM notification_channels WHERE ownerId=? AND archivedAt IS NULL').get(owner) as {n:number}).n;
      if(count>=20)throw new BadRequestException('最多配置 20 个通知通道');
      if(this.db.prepare('SELECT 1 FROM notification_channels WHERE ownerId=? AND url=? AND archivedAt IS NULL').get(owner,input.url))throw new ConflictException('该通知地址已经配置');
      const id=randomUUID();this.db.prepare('INSERT INTO notification_channels(id,ownerId,name,service,url,enabled,createdAt) VALUES(?,?,?,?,?,?,?)').run(id,owner,input.name,input.service,input.url,Number(input.enabled),new Date().toISOString());
      this.ledger.audit(owner,'notify.channel.create',id,{name:input.name,service:input.service,enabled:input.enabled});
    })();
    return this.state(owner);
  }
  private channel(owner:string,id:string){
    const row=this.db.prepare('SELECT * FROM notification_channels WHERE id=? AND ownerId=? AND archivedAt IS NULL').get(id,owner) as Channel|undefined;
    if(!row)throw new NotFoundException('通知通道不存在');return row;
  }
  update(owner:string,id:string,body:unknown,archive=false){
    const input=z.object({version:z.number().int().positive(),enabled:z.boolean().optional()}).strict().parse(body);
    if(!archive&&input.enabled===undefined)throw new BadRequestException('请选择启用状态');
    this.db.transaction(()=>{
      const row=this.channel(owner,id);if(row.version!==input.version)throw new ConflictException('通道已被修改，请刷新后重试');
      this.db.prepare('UPDATE notification_channels SET enabled=?,archivedAt=?,version=version+1 WHERE id=? AND ownerId=?').run(archive?0:Number(input.enabled),archive?new Date().toISOString():null,id,owner);
      this.ledger.audit(owner,archive?'notify.channel.remove':'notify.channel.update',id,{enabled:archive?false:input.enabled});
    })();return this.state(owner);
  }
  // 不返回网关响应正文：第三方错误可能包含完整 Token、Webhook 或邮箱密码。
  private async send(url:string,title:string,body:string){
    const endpoint=this.endpoint();
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(process.env.APPRISE_API_USERNAME||process.env.APPRISE_API_PASSWORD)headers.Authorization='Basic '+Buffer.from(`${process.env.APPRISE_API_USERNAME||''}:${process.env.APPRISE_API_PASSWORD||''}`).toString('base64');
    try{
      const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers,body:JSON.stringify({urls:url,title,body,format:'text',type:'info'})});
      const status=response.status;await response.body?.cancel();
      if(status!==200)throw new BadGatewayException(`Apprise 未确认投递成功（HTTP ${status}），请检查通道配置`);
    }catch(error){if(error instanceof BadGatewayException)throw error;throw new BadGatewayException('Apprise 连接失败或超时，请检查服务和通道配置');}
  }
  async sendSystem(title:string,body:string){
    if(!process.env.APPRISE_API_URL)return;
    const rows=this.db.prepare('SELECT url FROM notification_channels WHERE enabled=1 AND archivedAt IS NULL').all() as {url:string}[];
    await Promise.allSettled(rows.map(row=>this.send(row.url,title,body)));
  }
  async test(owner:string,body:unknown){
    const input=z.union([z.object({url:urlSchema}).strict(),z.object({channelId:z.string().uuid()}).strict()]).parse(body);
    const channel='channelId' in input?this.channel(owner,input.channelId):undefined;
    const id=channel?randomUUID():null,now=new Date().toISOString();
    if(channel)this.db.prepare("INSERT INTO notification_deliveries(id,ownerId,channelId,status,attempts,createdAt,updatedAt) VALUES(?,?,?,'sending',1,?,?)").run(id,owner,channel.id,now,now);
    try{
      await this.send(channel?channel.url:('url' in input?input.url:''),'useeCard 测试通知','收到此消息，说明 useeCard 已能通过这个通道发送提醒。此测试不包含账单数据。');
      if(id)this.db.prepare("UPDATE notification_deliveries SET status='sent',updatedAt=? WHERE id=?").run(new Date().toISOString(),id);
      this.ledger.audit(owner,'notify.test',channel?.id||owner,{result:'success'});return {ok:true};
    }catch(error){
      if(id)this.db.prepare("UPDATE notification_deliveries SET status='failed',lastError=?,updatedAt=? WHERE id=?").run((error as Error).message,new Date().toISOString(),id);
      this.ledger.audit(owner,'notify.test',channel?.id||owner,{result:'failed'});throw error;
    }
  }
  retry(owner:string,id:string){
    const row=this.db.prepare("SELECT * FROM notification_deliveries WHERE id=? AND ownerId=? AND status='failed' AND notificationId IS NOT NULL").get(id,owner) as Delivery|undefined;
    if(!row)throw new BadRequestException('此记录不能重试；测试通知请重新发送');
    const channel=this.channel(owner,row.channelId);if(!channel.enabled)throw new BadRequestException('请先启用通知通道');
    this.notifications.sync(owner);
    const notification=this.db.prepare('SELECT version,resolvedAt FROM notifications WHERE id=? AND ownerId=?').get(row.notificationId,owner) as {version:number;resolvedAt:string|null}|undefined;
    if(!notification||notification.resolvedAt||notification.version!==row.notificationVersion)throw new BadRequestException('账单提醒已变化，不再发送此旧记录');
    this.db.prepare("UPDATE notification_deliveries SET status='pending',attempts=0,nextAttemptAt=?,lastError=NULL WHERE id=? AND ownerId=?").run(new Date().toISOString(),id,owner);
    this.ledger.audit(owner,'notify.retry',id,{});return {ok:true};
  }
  run(){
    this.lastTickAt=Date.now();
    if(this.running||this.stopping||!process.env.APPRISE_API_URL)return this.running||Promise.resolve();
    const release=this.maintenance.background();if(!release)return Promise.resolve();
    this.running=this.deliver().catch(()=>{console.error('Apprise 后台投递检查失败');}).finally(()=>{release();this.running=undefined;});return this.running;
  }
  private async deliver(){
    const now=new Date().toISOString();
    // 上次进程中断的投递可以重试；网络失败可能已到达目标，无法承诺严格只送一次。
    this.db.prepare("UPDATE notification_deliveries SET status='failed',lastError='上次投递被中断，等待重试',nextAttemptAt=CASE WHEN attempts<3 THEN ? ELSE NULL END WHERE status='sending' AND updatedAt<?").run(now,new Date(Date.now()-60_000).toISOString());
    const channels=this.db.prepare('SELECT * FROM notification_channels WHERE enabled=1 AND archivedAt IS NULL').all() as Channel[];
    for(const owner of new Set(channels.map(v=>v.ownerId)))this.notifications.sync(owner);
    this.db.transaction(()=>{
      for(const channel of channels){
        const notifications=this.db.prepare("SELECT id,version FROM notifications WHERE ownerId=? AND kind<>'test' AND resolvedAt IS NULL").all(channel.ownerId) as {id:string;version:number}[];
        for(const notification of notifications)this.db.prepare("INSERT OR IGNORE INTO notification_deliveries(id,ownerId,channelId,notificationId,notificationVersion,status,nextAttemptAt,createdAt,updatedAt) VALUES(?,?,?,?,?,'pending',?,?,?) ON CONFLICT(channelId,notificationId,notificationVersion) DO UPDATE SET status='pending',nextAttemptAt=excluded.nextAttemptAt WHERE notification_deliveries.status='cancelled'").run(randomUUID(),channel.ownerId,channel.id,notification.id,notification.version,now,now,now);
      }
    })();
    const pending=this.db.prepare("SELECT * FROM notification_deliveries WHERE status IN ('pending','failed') AND nextAttemptAt IS NOT NULL AND nextAttemptAt<=? AND attempts<3 ORDER BY createdAt,id LIMIT 10").all(now) as Delivery[];
    for(const row of pending){
      if(this.stopping||this.maintenance.restoring)break;
      this.notifications.sync(row.ownerId);
      const channel=this.db.prepare('SELECT * FROM notification_channels WHERE id=? AND ownerId=? AND enabled=1 AND archivedAt IS NULL').get(row.channelId,row.ownerId) as Channel|undefined;
      const notification=this.db.prepare('SELECT * FROM notifications WHERE id=? AND ownerId=?').get(row.notificationId,row.ownerId) as {version:number;resolvedAt:string|null;kind:string;payload:string}|undefined;
      if(!channel||!notification||notification.resolvedAt||notification.version!==row.notificationVersion){this.db.prepare("UPDATE notification_deliveries SET status='cancelled',nextAttemptAt=NULL,updatedAt=? WHERE id=?").run(new Date().toISOString(),row.id);continue;}
      const item=JSON.parse(notification.payload) as NotificationItem;
      const title=notification.kind==='overdue'?'useeCard 扣款日已过，请确认':'useeCard 备款提醒';
      const body=`账户：${item.accountName}\n扣款日：${item.dueDate}\n已录入 ${item.billCount} 笔待确认账单，合计 ${formatMoney(item.amountMinor!,item.currency!)}。\n请以银行实际扣款结果为准。`;
      this.db.prepare("UPDATE notification_deliveries SET status='sending',attempts=attempts+1,updatedAt=? WHERE id=?").run(new Date().toISOString(),row.id);
      try{await this.send(channel.url,title,body);this.db.prepare("UPDATE notification_deliveries SET status='sent',nextAttemptAt=NULL,lastError=NULL,updatedAt=? WHERE id=?").run(new Date().toISOString(),row.id);}
      catch(error){const attempts=row.attempts+1;this.db.prepare("UPDATE notification_deliveries SET status='failed',lastError=?,nextAttemptAt=?,updatedAt=? WHERE id=?").run((error as Error).message,attempts<3?new Date(Date.now()+(attempts===1?60_000:300_000)).toISOString():null,new Date().toISOString(),row.id);}
    }
  }
}
