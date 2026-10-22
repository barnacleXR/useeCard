import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { addDays, addMinor, japanToday, type NotificationItem, type NotificationPage } from '@ccm/shared';
import { LedgerService } from '../common/ledger.service.js';
import { BillsService } from '../bills/bills.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { MaintenanceService } from '../data-management/maintenance.service.js';
type Payload=Pick<NotificationItem,'accountId'|'accountName'|'dueDate'|'currency'|'amountMinor'|'billCount'>;
type Row={id:string;version:number;kind:NotificationItem['kind'];payload:string;createdAt:string;updatedAt:string;readAt:string|null;resolvedAt:string|null};
const querySchema=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),filter:z.enum(['active','unread','history']).default('active')}).strict();
@Injectable()
export class NotificationsService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  lastTickAt=Date.now();
  constructor(@Inject(LedgerService) private readonly ledger:LedgerService,@Inject(BillsService) private readonly bills:BillsService,@Inject(SettingsService) private readonly settings:SettingsService,@Inject(MaintenanceService) private readonly maintenance:MaintenanceService){}
  private get db(){return this.ledger.db;}
  onModuleInit(){this.tick();this.timer=setInterval(()=>this.tick(),30_000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  private tick(){
    this.lastTickAt=Date.now();
    if(this.maintenance.restoring)return;
    for(const {id} of this.db.prepare('SELECT id FROM users').all() as {id:string}[]){
      try{this.sync(id);}catch(error){console.error('站内通知更新失败',error);}
    }
  }
  sync(owner:string,now=new Date()){
    const stamp=now.toISOString(),today=japanToday(now),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    const preferences=this.settings.preferences(owner);
    const groups=new Map<string,{kind:'upcoming'|'overdue';payload:Payload;members:string[]}>();
    const external=!!this.db.prepare('SELECT 1 FROM notification_channels WHERE ownerId=? AND enabled=1 AND archivedAt IS NULL LIMIT 1').get(owner)||!!this.db.prepare('SELECT 1 FROM push_subscriptions WHERE userId=? LIMIT 1').get(owner);
    if(preferences.inAppNotifications||external)for(const bill of this.bills.bills(owner,{status:'pending',to:addDays(today,preferences.reminderDaysBefore)})){
      const kind=bill.dueDate<today?'overdue':'upcoming';
      const notifyDate=addDays(bill.dueDate,-preferences.reminderDaysBefore);
      if(kind==='upcoming'&&notifyDate===today&&time<preferences.reminderTime)continue;
      const key=`${kind}:${bill.debitAccountId}:${bill.dueDate}:${bill.currency}`;
      let group=groups.get(key);
      if(!group){group={kind,payload:{accountId:bill.debitAccountId,accountName:bill.accountName,dueDate:bill.dueDate,currency:bill.currency,amountMinor:0,billCount:0},members:[]};groups.set(key,group);}
      group.payload.amountMinor=addMinor(group.payload.amountMinor!,bill.amountMinor);group.payload.billCount++;
      group.members.push(`${bill.id}:${bill.amountMinor}`);
    }
    this.db.transaction(()=>{
      const existing=this.db.prepare("SELECT id,notificationKey,fingerprint,resolvedAt FROM notifications WHERE ownerId=? AND kind<>'test'").all(owner) as {id:string;notificationKey:string;fingerprint:string;resolvedAt:string|null}[];
      const byKey=new Map(existing.map(v=>[v.notificationKey,v]));
      for(const [key,group] of groups){
        const fingerprint=createHash('sha256').update(JSON.stringify([group.payload,group.members.sort()])).digest('hex'),old=byKey.get(key);
        if(!old)this.db.prepare('INSERT INTO notifications(id,ownerId,notificationKey,kind,payload,fingerprint,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),owner,key,group.kind,JSON.stringify(group.payload),fingerprint,stamp,stamp);
        else if(old.fingerprint!==fingerprint||old.resolvedAt)this.db.prepare('UPDATE notifications SET payload=?,fingerprint=?,version=version+1,updatedAt=?,readAt=NULL,resolvedAt=NULL WHERE id=? AND ownerId=?').run(JSON.stringify(group.payload),fingerprint,stamp,old.id,owner);
      }
      for(const old of existing)if(!old.resolvedAt&&!groups.has(old.notificationKey))this.db.prepare('UPDATE notifications SET resolvedAt=?,updatedAt=? WHERE id=? AND ownerId=?').run(stamp,stamp,old.id,owner);
    })();
  }
  list(owner:string,raw:unknown):NotificationPage{
    const q=querySchema.parse(raw);this.sync(owner);
    const visible=this.settings.preferences(owner).inAppNotifications?'1=1':"kind='test'";
    const condition=q.filter==='history'?'1=1':`(${visible}) AND resolvedAt IS NULL${q.filter==='unread'?' AND readAt IS NULL':''}`;
    return this.db.transaction(()=>{
      const total=(this.db.prepare(`SELECT count(*) n FROM notifications WHERE ownerId=? AND ${condition}`).get(owner) as {n:number}).n;
      const unreadCount=this.count(owner);
      const rows=this.db.prepare(`SELECT id,version,kind,payload,createdAt,updatedAt,readAt,resolvedAt FROM notifications WHERE ownerId=? AND ${condition} ORDER BY updatedAt DESC,id DESC LIMIT ? OFFSET ?`).all(owner,q.pageSize,(q.page-1)*q.pageSize) as Row[];
      return {items:rows.map(({payload,...row})=>({...row,...JSON.parse(payload) as Payload})),total,unreadCount,page:q.page,pageSize:q.pageSize};
    })();
  }
  private count(owner:string){const visible=this.settings.preferences(owner).inAppNotifications?'1=1':"kind='test'";return (this.db.prepare(`SELECT count(*) n FROM notifications WHERE ownerId=? AND readAt IS NULL AND resolvedAt IS NULL AND (${visible})`).get(owner) as {n:number}).n;}
  unread(owner:string){this.sync(owner);return {unreadCount:this.count(owner)};}
  read(owner:string,body:unknown){
    const {items}=z.object({items:z.array(z.object({id:z.string().uuid(),version:z.number().int().positive()}).strict()).min(1).max(100)}).strict().parse(body);
    this.db.transaction(()=>{for(const {id,version} of items)this.db.prepare('UPDATE notifications SET readAt=? WHERE ownerId=? AND id=? AND version=? AND readAt IS NULL').run(new Date().toISOString(),owner,id,version);})();
    return {ok:true};
  }
  readAll(owner:string){this.sync(owner);this.db.prepare('UPDATE notifications SET readAt=? WHERE ownerId=? AND readAt IS NULL AND resolvedAt IS NULL').run(new Date().toISOString(),owner);return {ok:true};}
  test(owner:string){
    const id=randomUUID(),now=new Date().toISOString();
    this.db.prepare('INSERT INTO notifications(id,ownerId,notificationKey,kind,payload,fingerprint,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,`test:${id}`,'test',JSON.stringify({accountId:null,accountName:'站内测试通知',dueDate:null,currency:null,amountMinor:null,billCount:0}),'test',now,now);
    return {id};
  }
}
