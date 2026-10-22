import { BadRequestException, ConflictException, Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, closeSync, readSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import type { Readable } from 'node:stream';
import { LedgerService } from '../common/ledger.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { AuthService } from '../auth/auth.service.js';

const MAX_DB = 1024 * 1024 * 1024;
const LEGACY_MAX_DB = 64 * 1024 * 1024;
const MAGIC = Buffer.from('USEECARD_BACKUP_V2\n');
const filenamePattern = /^ccm-\d{14}-[a-f0-9-]{36}\.backup\.(?:json|ucb)$/;
const scheduleSchema = z.object({frequency: z.enum(['off','daily','weekly']), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), weekday: z.number().int().min(0).max(6), retentionDays: z.number().int().min(1).max(365)}).strict();
export type BackupSchedule = z.infer<typeof scheduleSchema>;
export interface BackupMeta { id: string; createdAt: string; schemaVersion: number; bytes: number; reason: 'manual' | 'automatic' | 'before-restore'; sha256: string; counts: Record<string, number> }
interface BackupEnvelope { format: 'ccm-backup'; version: 1; appVersion: string; meta: BackupMeta; databaseBase64: string; deployment: {baseUrl: string | null; timeZone: 'Asia/Tokyo'} }
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private retryAt = 0;
  lastTickAt=Date.now();
  private uploads = new Map<string,{owner:string;path:string;size:number;received:number;sha256?:string;createdAt:number}>();
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService, @Inject(MaintenanceService) private readonly maintenance: MaintenanceService, @Inject(AuthService) private readonly auth: AuthService) {}
  private get db() { return this.ledger.db; }
  private get directory() {
    const location = this.db.name === ':memory:' ? join(tmpdir(), 'ccm-memory-backups') : join(dirname(resolve(this.db.name)), 'backups');
    const dir = resolve(process.env.BACKUP_DIR || location);
    mkdirSync(dir, {recursive: true, mode: 0o700}); return dir;
  }
  private readSetting(key: string) { return (this.db.prepare('SELECT value FROM instance_settings WHERE key=?').get(key) as {value: string} | undefined)?.value; }
  private setting(key: string, value: unknown) { this.db.prepare('INSERT INTO instance_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  status() {
    return {running:this.busy,schedule: this.schedule(), latest: JSON.parse(this.readSetting('backupLatest') || 'null'), lastSuccessAt:JSON.parse(this.readSetting('backupLastSuccessAt')||'null'),lastFailureAt:JSON.parse(this.readSetting('backupLastFailureAt')||'null'), backups: this.list(), maxDatabaseBytes: MAX_DB, nextRun: this.nextRun(), timeZone: 'Asia/Tokyo', directoryManagedByDeployment: !!process.env.BACKUP_DIR};
  }
  schedule(): BackupSchedule { return scheduleSchema.parse(JSON.parse(this.readSetting('backupSchedule') || '{"frequency":"daily","time":"03:00","weekday":0,"retentionDays":30}')); }
  nextRun(now = new Date()): string | null {
    const config = this.schedule(); if (config.frequency === 'off') return null;
    const japan = new Date(now.getTime()+9*3600_000);
    for (let days=0;days<8;days++) {
      const date=new Date(Date.UTC(japan.getUTCFullYear(),japan.getUTCMonth(),japan.getUTCDate()+days));
      if (config.frequency==='weekly' && date.getUTCDay()!==config.weekday) continue;
      const candidate=new Date(`${date.toISOString().slice(0,10)}T${config.time}:00+09:00`);
      if (candidate>now) return candidate.toISOString();
    }
    return null;
  }
  saveSchedule(owner: string, input: unknown) {
    const config = scheduleSchema.parse(input); this.setting('backupSchedule', config); this.ledger.audit(owner, 'backup.schedule', owner, config); return config;
  }
  list(): BackupMeta[] {
    const dir = this.directory;
    return readdirSync(dir).filter(f => filenamePattern.test(f)).flatMap(id => {
      try { const meta = JSON.parse(readFileSync(join(dir, id + '.meta'), 'utf8')) as BackupMeta; return meta.id === id ? [meta] : []; } catch { return []; }
    }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  file(id: string) {
    if (!filenamePattern.test(id) || !existsSync(join(this.directory, id))) throw new BadRequestException('备份不存在');
    return join(this.directory, id);
  }
  private tables(db: Database.Database) {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name: string}[]).map(row => row.name);
  }
  // 根据真实外键依赖排列：父表先插入，子表先删除，避免延迟约束计数残留。
  private restoreOrder() {
    const ordered: string[] = [], visiting = new Set<string>(), done = new Set<string>();
    const visit = (table: string) => {
      if (done.has(table)) return;
      if (visiting.has(table)) throw new BadRequestException('数据库存在循环依赖，无法恢复');
      visiting.add(table);
      const parents = this.db.pragma(`foreign_key_list("${table}")`) as {table:string}[];
      for (const parent of parents) visit(parent.table);
      visiting.delete(table); done.add(table); ordered.push(table);
    };
    for (const table of this.tables(this.db)) visit(table);
    return ordered;
  }
  private schema(db: Database.Database) { return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()); }
  private counts(db: Database.Database) { return Object.fromEntries(this.tables(db).map(name => [name, (db.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as {n: number}).n])); }
  private version(db: Database.Database) { return (db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as {v: number}).v; }
  private enoughSpace(bytes: number) {
    const space = statfsSync(this.directory);
    if (space.bavail * space.bsize < bytes * 3 + 16 * 1024 * 1024) throw new BadRequestException('备份目录磁盘空间不足');
  }
  // 使用 SQLite online backup API，包含 WAL 中尚未检查点的数据。
  async create(owner: string, reason: BackupMeta['reason'] = 'manual'): Promise<BackupMeta> {
    if (this.busy) throw new ConflictException('已有备份任务正在进行');
    this.busy = true;
    const temporary = join(this.directory, `.${randomUUID()}.sqlite`);
    let finalPath: string | undefined;
    let pendingPath: string | undefined;
    try {
      const pageCount = this.db.pragma('page_count', {simple: true}) as number;
      const pageSize = this.db.pragma('page_size', {simple: true}) as number;
      if (pageCount * pageSize > MAX_DB) throw new BadRequestException('当前数据库超过 1 GiB');
      this.enoughSpace(pageCount * pageSize);
      await this.db.backup(temporary);
      const snapshot = new Database(temporary, {readonly: true});
      let counts: Record<string, number>, version: number;
      try { counts = this.counts(snapshot); version = this.version(snapshot); } finally { snapshot.close(); }
      const bytes = statSync(temporary).size;
      if (bytes > MAX_DB) throw new BadRequestException('数据库超过 1 GiB');
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(temporary)) digest.update(chunk as Buffer);
      const createdAt = new Date().toISOString();
      const id = `ccm-${createdAt.replace(/\D/g,'').slice(0,14)}-${randomUUID()}.backup.ucb`;
      const meta: BackupMeta = {id, createdAt, schemaVersion: version, bytes, reason, sha256: digest.digest('hex'), counts};
      const manifest = Buffer.from(JSON.stringify({format:'useecard-backup',version:2,appVersion:'2.0.0',meta,kind:'sqlite'}));
      const length = Buffer.alloc(4); length.writeUInt32BE(manifest.length);
      const pending = this.filePath(id + '.pending'); pendingPath = pending; finalPath = this.filePath(id);
      writeFileSync(pending, Buffer.concat([MAGIC,length,manifest]), {mode: 0o600});
      await pipeline(createReadStream(temporary),createWriteStream(pending,{flags:'a'}));
      renameSync(pending, finalPath);
      writeFileSync(this.filePath(id + '.meta'), JSON.stringify(meta), {mode: 0o600});
      this.setting('backupLatest', {ok: true, at: createdAt, id});
      this.setting('backupLastSuccessAt',createdAt);
      this.ledger.audit(owner, 'backup.create', id, {reason}); return meta;
    } catch (error) {
      if (finalPath) { rmSync(finalPath, {force:true}); rmSync(finalPath + '.meta', {force:true}); }
      const at=new Date().toISOString();this.setting('backupLatest', {ok:false, at, message:(error as Error).message});this.setting('backupLastFailureAt',at);throw error;
    } finally { this.busy = false; if (pendingPath) rmSync(pendingPath,{force:true}); rmSync(temporary, {force:true}); rmSync(temporary+'-wal',{force:true}); rmSync(temporary+'-shm',{force:true}); }
  }
  private filePath(name: string) { return join(this.directory, name); }
  private validate(input: unknown): {bytes: Buffer; meta: BackupMeta} {
    const parsed = z.object({format:z.literal('ccm-backup'),version:z.literal(1),appVersion:z.string(),meta:z.object({id:z.string().regex(filenamePattern),createdAt:z.string().datetime(),reason:z.enum(['manual','automatic','before-restore']),sha256:z.string().regex(/^[a-f0-9]{64}$/),schemaVersion:z.number().int(),bytes:z.number().int().positive().max(LEGACY_MAX_DB),counts:z.record(z.string(),z.number().int().nonnegative())}).passthrough(),databaseBase64:z.string().max(Math.ceil(LEGACY_MAX_DB/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).passthrough().parse(input);
    const bytes = Buffer.from(parsed.databaseBase64, 'base64');
    if (bytes.length !== parsed.meta.bytes || checksum(bytes) !== parsed.meta.sha256 || bytes.subarray(0,16).toString() !== 'SQLite format 3\0') throw new BadRequestException('备份内容或校验和不匹配');
    if (parsed.meta.schemaVersion > this.version(this.db)) throw new BadRequestException('备份数据库版本高于当前服务');
    return {bytes, meta:parsed.meta as BackupMeta};
  }
  private inspect(candidate: Database.Database, meta: BackupMeta) {
    if (candidate.pragma('integrity_check', {simple:true}) !== 'ok' || (candidate.pragma('foreign_key_check') as unknown[]).length) throw new BadRequestException('备份数据库完整性校验失败');
    if (this.version(candidate) !== meta.schemaVersion) throw new BadRequestException('备份数据库版本不匹配');
    if(meta.schemaVersion===this.version(this.db)&&this.schema(candidate)!==this.schema(this.db))throw new BadRequestException('备份数据库结构不匹配');
    if (JSON.stringify(this.counts(candidate)) !== JSON.stringify(meta.counts)) throw new BadRequestException('备份记录数量不匹配');
    if ((candidate.prepare('SELECT count(*) AS n FROM users').get() as {n:number}).n !== 1) throw new BadRequestException('备份必须包含一个管理员账号');
  }
  async restore(owner: string, input: unknown) {
    const {password, backup} = z.object({password:z.string().min(1).max(128),backup:z.unknown()}).strict().parse(input);
    const username = (this.db.prepare('SELECT username FROM users WHERE id=?').get(owner) as {username:string}).username;
    this.auth.verifyCredentials(username,password,`restore:${owner}`);
    const {bytes,meta} = this.validate(backup); this.enoughSpace(bytes.length);
    const candidatePath = this.filePath(`.${randomUUID()}.restore.sqlite`);
    writeFileSync(candidatePath,bytes,{mode:0o600});
    try { return await this.applyCandidate(owner,candidatePath,meta); }
    finally { rmSync(candidatePath,{force:true}); }
  }
  private verifyPassword(owner: string, password: string) {
    const user = this.db.prepare('SELECT username FROM users WHERE id=?').get(owner) as {username:string} | undefined;
    if (!user) throw new BadRequestException('账号不存在');
    this.auth.verifyCredentials(user.username,password,`restore:${owner}`);
  }
  // 二进制归档：固定魔数、长度受限的 JSON 清单和原始 SQLite 数据流。
  async restoreArchive(owner: string, password: string, archivePath: string) {
    this.verifyPassword(owner,password);
    const fd=openSync(archivePath,'r'); let offset=0;
    try {
      const header=Buffer.alloc(MAGIC.length+4);
      if(readSync(fd,header,0,header.length,0)!==header.length || !header.subarray(0,MAGIC.length).equals(MAGIC)) throw new BadRequestException('备份文件格式无效');
      const manifestBytes=header.readUInt32BE(MAGIC.length);
      if(manifestBytes<2 || manifestBytes>65536) throw new BadRequestException('备份清单过大');
      const raw=Buffer.alloc(manifestBytes); offset=header.length+manifestBytes;
      if(readSync(fd,raw,0,manifestBytes,header.length)!==manifestBytes) throw new BadRequestException('备份清单不完整');
      let manifest:unknown;try{manifest=JSON.parse(raw.toString());}catch{throw new BadRequestException('备份清单无法解析');}
      const parsed=z.object({format:z.literal('useecard-backup'),version:z.literal(2),kind:z.literal('sqlite'),meta:z.object({id:z.string().regex(filenamePattern),createdAt:z.string(),reason:z.enum(['manual','automatic','before-restore']),sha256:z.string().regex(/^[a-f0-9]{64}$/),schemaVersion:z.number().int(),bytes:z.number().int().positive().max(MAX_DB),counts:z.record(z.string(),z.number().int().nonnegative())})}).parse(manifest);
      const meta=parsed.meta as BackupMeta;
      if(statSync(archivePath).size-offset!==meta.bytes) throw new BadRequestException('备份长度不匹配');
      this.enoughSpace(meta.bytes);
      const candidatePath=this.filePath(`.${randomUUID()}.restore.sqlite`);
      try {
        const digest=createHash('sha256');
        const source=createReadStream(archivePath,{start:offset});
        source.on('data',(chunk)=>{digest.update(chunk);});
        await pipeline(source,createWriteStream(candidatePath,{mode:0o600}));
        if(digest.digest('hex')!==meta.sha256) throw new BadRequestException('备份校验和不匹配');
        return await this.applyCandidate(owner,candidatePath,meta);
      } finally {rmSync(candidatePath,{force:true});}
    } finally {closeSync(fd);}
  }
  private async applyCandidate(owner: string, candidatePath: string, meta: BackupMeta) {
    try {
      const candidate = new Database(candidatePath,{readonly:true});
      try { this.inspect(candidate,meta); } finally { candidate.close(); }
      if(meta.schemaVersion<this.version(this.db)) {
        const migrated=new (await import('../database.js')).DatabaseService(candidatePath);
        migrated.close();
      }
      const compatible=new Database(candidatePath,{readonly:true});
      try { if(this.schema(compatible)!==this.schema(this.db)) throw new BadRequestException('备份数据库结构不匹配'); }
      finally { compatible.close(); }
      if (this.busy) throw new ConflictException('请等待备份完成后再恢复');
      await this.maintenance.enter();
      try {
        const safety = await this.create(owner,'before-restore');
        // 相同结构的完整表替换在单个 SQLite 事务内完成；异常自动回滚，无需更换活动文件句柄。
        this.db.prepare('ATTACH DATABASE ? AS ccm_restore').run(candidatePath);
        try {
          const tables = this.restoreOrder();
          this.db.transaction(() => {
            for (const table of [...tables].reverse()) this.db.exec(`DELETE FROM main."${table}"`);
            for (const table of tables) this.db.exec(`INSERT INTO main."${table}" SELECT * FROM ccm_restore."${table}"`);
            // 备份中的旧授权不能复活，恢复成功后所有入口重新认证。
            for (const table of ['sessions','device_sessions','pairing_codes','api_keys','oauth_grants','oauth_codes','push_subscriptions']) this.db.exec(`DELETE FROM "${table}"`);
            this.db.exec('DELETE FROM system_alerts');
            this.db.prepare("DELETE FROM instance_settings WHERE key IN ('backupLatest','backupLastSlot','backupLastSuccessAt','backupLastFailureAt')").run();
            this.setting('backupSchedule', {frequency:'off',time:'03:00',weekday:0,retentionDays:30});
            this.setting('dataEpoch',randomUUID());
            const restoredOwner = (this.db.prepare('SELECT id FROM users LIMIT 1').get() as {id:string}).id;
            this.db.prepare('UPDATE notification_channels SET enabled=0,version=version+1').run();
            this.db.prepare("UPDATE notification_deliveries SET status='cancelled',nextAttemptAt=NULL WHERE status IN ('pending','sending','failed')").run();
            this.ledger.audit(restoredOwner,'backup.restore',meta.id || 'uploaded',{sha256:meta.sha256,safetyBackup:safety.id});
            if ((this.db.pragma('foreign_key_check') as unknown[]).length) throw new BadRequestException('恢复后的外键校验失败');
          })();
        } finally { this.db.exec('DETACH DATABASE ccm_restore'); }
        return {ok:true,requiresLogin:true,safetyBackup:safety.id};
      } finally { this.maintenance.leave(); }
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || (error as {getStatus?:unknown}).getStatus) throw error;
      console.error('备份恢复事务失败', error);
      throw new BadRequestException('备份恢复失败，当前数据已保持原状');
    } finally { /* 候选库由调用方删除。 */ }
  }
  delete(owner:string,id:string) {
    const path=this.file(id); rmSync(path); rmSync(path+'.meta',{force:true});
    this.ledger.audit(owner,'backup.delete',id,{}); return {ok:true};
  }
  startUpload(owner:string,input:unknown) {
    const {size,sha256}=z.object({size:z.number().int().positive().max(MAX_DB+65536),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(input);
    this.enoughSpace(size);
    const id=randomUUID(),path=this.filePath(`.${id}.upload`);
    writeFileSync(path,'',{mode:0o600});
    this.uploads.set(id,{owner,path,size,received:0,sha256,createdAt:Date.now()});
    return {id,chunkBytes:8*1024*1024};
  }
  async uploadChunk(owner:string,id:string,offset:number,stream:Readable) {
    const upload=this.uploads.get(id);
    if(!upload || upload.owner!==owner) throw new BadRequestException('上传任务不存在');
    if(offset!==upload.received) throw new ConflictException('上传位置不匹配');
    let written=0;
    const fd=openSync(upload.path,'a');
    try {
      for await(const chunk of stream) {
        const bytes=chunk as Buffer; written+=bytes.length;
        if(written>8*1024*1024 || offset+written>upload.size) throw new BadRequestException('分块超过限制');
        const {writeSync}=await import('node:fs'); writeSync(fd,bytes);
      }
      if(written===0) throw new BadRequestException('分块不能为空');
      upload.received+=written;
      return {received:upload.received,size:upload.size};
    } catch(error) { this.uploads.delete(id);rmSync(upload.path,{force:true});throw error; }
    finally {closeSync(fd);}
  }
  async finishUpload(owner:string,id:string,password:string) {
    const upload=this.uploads.get(id);
    if(!upload || upload.owner!==owner) throw new BadRequestException('上传任务不存在');
    if(upload.received!==upload.size) throw new ConflictException('文件尚未上传完成');
    this.uploads.delete(id);
    try {
      const digest=createHash('sha256');for await(const part of createReadStream(upload.path)) digest.update(part as Buffer);
      const uploadedHash=digest.digest('hex');if(upload.sha256&&uploadedHash!==upload.sha256) throw new BadRequestException('上传文件校验失败');
      const fd=openSync(upload.path,'r');const head=Buffer.alloc(MAGIC.length);readSync(fd,head,0,head.length,0);closeSync(fd);
      if(head.equals(MAGIC)) return await this.restoreArchive(owner,password,upload.path);
      if(upload.size>Math.ceil(LEGACY_MAX_DB/3)*4+65536) throw new BadRequestException('旧格式备份过大');
      let legacy:unknown;try{legacy=JSON.parse(readFileSync(upload.path,'utf8'));}catch{throw new BadRequestException('旧版备份文件无法解析');}
      return await this.restore(owner,{password,backup:legacy});
    } finally {rmSync(upload.path,{force:true});}
  }
  onModuleInit() { this.timer = setInterval(() => { void this.tick(); const cutoff=Date.now()-3600_000;for(const [id,item] of this.uploads) if(item.createdAt<cutoff){this.uploads.delete(id);rmSync(item.path,{force:true});} },30_000); this.timer.unref();
    // 进程异常退出后，清除上次遗留的上传、候选库和未完成归档。
    for(const name of readdirSync(this.directory)) if((/^\.[a-f0-9-]{36}\.(?:upload|restore\.sqlite|sqlite)(?:-wal|-shm)?$/.test(name) || (name.endsWith('.pending') && filenamePattern.test(name.slice(0,-8)))) && Date.now()-statSync(this.filePath(name)).mtimeMs>3600_000) rmSync(this.filePath(name),{force:true}); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  // 业务时区固定日本；错过当天时刻会在当天启动后补做，持久化槽位避免重启重复。
  async tick(now = new Date()) {
    this.lastTickAt=Date.now();
    if (this.busy || this.maintenance.restoring || now.getTime() < this.retryAt) return;
    const config = this.schedule(); if (config.frequency === 'off') return;
    const japan = new Date(now.getTime()+9*3600_000), date=japan.toISOString().slice(0,10), time=japan.toISOString().slice(11,16);
    if (time < config.time || (config.frequency === 'weekly' && japan.getUTCDay() !== config.weekday) || this.readSetting('backupLastSlot') === JSON.stringify(date)) return;
    const owner = this.db.prepare('SELECT id FROM users LIMIT 1').get() as {id:string} | undefined; if (!owner) return;
    try {
      await this.create(owner.id,'automatic'); this.setting('backupLastSlot',date);
      for (const meta of this.list()) if (meta.reason === 'automatic' && Date.parse(meta.createdAt) < now.getTime()-config.retentionDays*86400_000) {
        rmSync(this.file(meta.id),{force:true}); rmSync(this.filePath(meta.id+'.meta'),{force:true});
      }
    } catch (error) {
      this.retryAt = now.getTime()+15*60_000;
      this.setting('backupLatest',{ok:false,at:now.toISOString(),message:(error as Error).message});this.setting('backupLastFailureAt',now.toISOString());
    }
  }
}
