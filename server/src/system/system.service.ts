import { existsSync, statfsSync, statSync } from 'node:fs';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database.js';
import { BackupService } from '../data-management/backup.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AppriseService } from '../notifications/apprise.service.js';
import { PushService } from '../notifications/push.service.js';

type Finding={key:string;severity:'warning'|'critical';message:string};
@Injectable()
export class SystemService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private initial?:ReturnType<typeof setTimeout>;
  private startedAt=Date.now();
  lastCheckAt=Date.now();
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(BackupService) private readonly backup:BackupService,@Inject(NotificationsService) private readonly notifications:NotificationsService,@Inject(AppriseService) private readonly apprise:AppriseService,@Inject(PushService) private readonly push:PushService){}
  private get db(){return this.database.db;}
  status(){
    const path=this.db.name,space=statfsSync(path===':memory:'?process.cwd():path);
    const total=space.blocks*space.bsize,free=space.bavail*space.bsize,usage=total?1-free/total:0;
    const databaseBytes=path!==':memory:'?(existsSync(path)?statSync(path).size:0)+(existsSync(path+'-wal')?statSync(path+'-wal').size:0):0;
    const backup=this.backup.status();
    const failedLogins=(this.db.prepare("SELECT count(*) n FROM audit_events WHERE action IN ('auth.login.failed','auth.login.rate_limited') AND createdAt>=?").get(new Date(Date.now()-3600_000).toISOString()) as {n:number}).n;
    const activeGrants=(this.db.prepare('SELECT count(*) n FROM oauth_grants WHERE revokedAt IS NULL AND refreshExpiresAt>?').get(Date.now()) as {n:number}).n;
    const apiKeys=(this.db.prepare('SELECT count(*) n FROM api_keys WHERE revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt>?)').get(new Date().toISOString()) as {n:number}).n;
    return {version:'2.0.0',disk:{total,free,usage},databaseBytes,backup:{running:backup.running,schedule:backup.schedule,latest:backup.latest,lastSuccessAt:backup.lastSuccessAt,lastFailureAt:backup.lastFailureAt,nextRun:backup.nextRun,backups:backup.backups.length},jobs:{backup:this.backup.lastTickAt,notifications:this.notifications.lastTickAt,apprise:this.apprise.lastTickAt,push:this.push.lastTickAt,system:this.lastCheckAt},failedLogins,activeGrants,apiKeys,alerts:this.db.prepare('SELECT key,severity,message,active,lastSentAt,changedAt FROM system_alerts ORDER BY key').all()};
  }
  findings(now=Date.now()):Finding[]{const s=this.status(),result:Finding[]=[];
    if(s.disk.usage>=0.92)result.push({key:'disk',severity:'critical',message:'磁盘使用率已达到 92%，请清理空间。'});
    else if(s.disk.usage>=0.85)result.push({key:'disk',severity:'warning',message:'磁盘使用率已达到 85%，请检查剩余空间。'});
    if(s.backup.schedule.frequency!=='off'){
      const success=this.db.prepare("SELECT value FROM instance_settings WHERE key='backupLastSuccessAt'").get() as {value:string}|undefined;
      const last=success?Date.parse(JSON.parse(success.value)):this.startedAt;
      const japan=new Date(now+9*3600_000),config=s.backup.schedule;
      for(let back=0;back<8;back++){
        const date=new Date(Date.UTC(japan.getUTCFullYear(),japan.getUTCMonth(),japan.getUTCDate()-back));
        if(config.frequency==='weekly'&&date.getUTCDay()!==config.weekday)continue;
        const planned=Date.parse(`${date.toISOString().slice(0,10)}T${config.time}:00+09:00`);
        if(planned<=now){if(now-planned>2*3600_000&&last<planned)result.push({key:'backup',severity:'critical',message:'自动备份已超过计划时间两小时仍未成功。'});break;}
      }
      if(s.backup.latest && !s.backup.latest.ok)result.push({key:'backup-failure',severity:'critical',message:'最近一次备份失败，请检查备份设置。'});
    }
    if(Object.values(s.jobs).some(stamp=>now-stamp>120_000))result.push({key:'jobs',severity:'critical',message:'后台任务心跳已停止。'});
    if(s.failedLogins>=30)result.push({key:'failed-login',severity:'critical',message:'最近一小时失败登录达到 30 次。'});
    return result;
  }
  async check(now=Date.now()){
    this.lastCheckAt=now;
    this.db.prepare('DELETE FROM audit_events WHERE createdAt<?').run(new Date(now-180*86400_000).toISOString());
    const findings=this.findings(now),current=new Map(findings.map(v=>[v.key,v]));
    const old=this.db.prepare('SELECT key,active,lastSentAt FROM system_alerts').all() as {key:string;active:number;lastSentAt:string|null}[];
    for(const finding of findings){const previous=old.find(v=>v.key===finding.key),send=!previous?.lastSentAt||now-Date.parse(previous.lastSentAt)>=86400_000;
      this.db.prepare('INSERT INTO system_alerts(key,severity,message,active,lastSentAt,changedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET severity=excluded.severity,message=excluded.message,active=1,lastSentAt=excluded.lastSentAt,changedAt=CASE WHEN system_alerts.active=0 THEN excluded.changedAt ELSE system_alerts.changedAt END')
        .run(finding.key,finding.severity,finding.message,1,send?new Date(now).toISOString():previous?.lastSentAt||null,new Date(now).toISOString());
      if(send)await this.send('useeCard 系统告警',finding.message);
    }
    for(const row of old)if(row.active&&!current.has(row.key)){
      this.db.prepare('UPDATE system_alerts SET active=0,changedAt=? WHERE key=?').run(new Date(now).toISOString(),row.key);
      await this.send('useeCard 系统恢复',`${({disk:'磁盘空间',backup:'自动备份','backup-failure':'备份失败',jobs:'后台任务','failed-login':'失败登录'} as Record<string,string>)[row.key]||row.key}已恢复正常。`);
    }
  }
  private async send(title:string,body:string){await Promise.allSettled([this.apprise.sendSystem(title,body),this.push.sendSystem(title,body)]);}
  metrics(){const s=this.status();return `# TYPE useecard_disk_usage_ratio gauge\nuseecard_disk_usage_ratio ${s.disk.usage}\n# TYPE useecard_database_bytes gauge\nuseecard_database_bytes ${s.databaseBytes}\n# TYPE useecard_failed_logins_1h gauge\nuseecard_failed_logins_1h ${s.failedLogins}\n# TYPE useecard_active_oauth_grants gauge\nuseecard_active_oauth_grants ${s.activeGrants}\n`;}
  onModuleInit(){this.initial=setTimeout(()=>{void this.check().catch(()=>console.error('系统状态检查失败'));},10_000);this.initial.unref();this.timer=setInterval(()=>{void this.check().catch(()=>console.error('系统状态检查失败'));},3600_000);this.timer.unref();}
  onModuleDestroy(){if(this.initial)clearTimeout(this.initial);if(this.timer)clearInterval(this.timer);}
}
