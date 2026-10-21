import { BadRequestException, ConflictException, Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { LedgerService } from '../common/ledger.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { AuthService } from '../auth/auth.service.js';

const MAX_DB = 64 * 1024 * 1024;
const filenamePattern = /^ccm-\d{14}-[a-f0-9-]{36}\.backup\.json$/;
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
    return {schedule: this.schedule(), latest: JSON.parse(this.readSetting('backupLatest') || 'null'), backups: this.list(), maxDatabaseBytes: MAX_DB, timeZone: 'Asia/Tokyo', directoryManagedByDeployment: !!process.env.BACKUP_DIR};
  }
  schedule(): BackupSchedule { return scheduleSchema.parse(JSON.parse(this.readSetting('backupSchedule') || '{"frequency":"off","time":"03:00","weekday":0,"retentionDays":30}')); }
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
      if (pageCount * pageSize > MAX_DB) throw new BadRequestException('当前数据库超过 64 MB，请使用运维备份流程');
      this.enoughSpace(pageCount * pageSize);
      await this.db.backup(temporary);
      const snapshot = new Database(temporary, {readonly: true});
      let counts: Record<string, number>, version: number;
      try { counts = this.counts(snapshot); version = this.version(snapshot); } finally { snapshot.close(); }
      const bytes = readFileSync(temporary);
      if (bytes.length > MAX_DB) throw new BadRequestException('数据库超过 64 MB');
      const createdAt = new Date().toISOString();
      const id = `ccm-${createdAt.replace(/\D/g,'').slice(0,14)}-${randomUUID()}.backup.json`;
      const meta: BackupMeta = {id, createdAt, schemaVersion: version, bytes: bytes.length, reason, sha256: checksum(bytes), counts};
      const envelope: BackupEnvelope = {format: 'ccm-backup', version: 1, appVersion: '2.0.0', meta, deployment: {baseUrl: process.env.BASE_URL || null, timeZone: 'Asia/Tokyo'}, databaseBase64: bytes.toString('base64')};
      const pending = this.filePath(id + '.pending'); pendingPath = pending; finalPath = this.filePath(id);
      writeFileSync(pending, JSON.stringify(envelope), {mode: 0o600}); renameSync(pending, finalPath);
      writeFileSync(this.filePath(id + '.meta'), JSON.stringify(meta), {mode: 0o600});
      this.setting('backupLatest', {ok: true, at: createdAt, id});
      this.ledger.audit(owner, 'backup.create', id, {reason}); return meta;
    } catch (error) {
      if (finalPath) { rmSync(finalPath, {force:true}); rmSync(finalPath + '.meta', {force:true}); }
      this.setting('backupLatest', {ok:false, at:new Date().toISOString(), message:(error as Error).message}); throw error;
    } finally { this.busy = false; if (pendingPath) rmSync(pendingPath,{force:true}); rmSync(temporary, {force:true}); rmSync(temporary+'-wal',{force:true}); rmSync(temporary+'-shm',{force:true}); }
  }
  private filePath(name: string) { return join(this.directory, name); }
  private validate(input: unknown): {bytes: Buffer; meta: BackupMeta} {
    const parsed = z.object({format:z.literal('ccm-backup'),version:z.literal(1),appVersion:z.string(),meta:z.object({id:z.string().regex(filenamePattern),createdAt:z.string().datetime(),reason:z.enum(['manual','automatic','before-restore']),sha256:z.string().regex(/^[a-f0-9]{64}$/),schemaVersion:z.number().int(),bytes:z.number().int().positive().max(MAX_DB),counts:z.record(z.string(),z.number().int().nonnegative())}).passthrough(),databaseBase64:z.string().max(Math.ceil(MAX_DB/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).passthrough().parse(input);
    const bytes = Buffer.from(parsed.databaseBase64, 'base64');
    if (bytes.length !== parsed.meta.bytes || checksum(bytes) !== parsed.meta.sha256 || bytes.subarray(0,16).toString() !== 'SQLite format 3\0') throw new BadRequestException('备份内容或校验和不匹配');
    if (parsed.meta.schemaVersion !== this.version(this.db)) throw new BadRequestException('备份数据库版本与当前服务不一致，请先使用对应版本恢复');
    return {bytes, meta:parsed.meta as BackupMeta};
  }
  private inspect(candidate: Database.Database, meta: BackupMeta) {
    if (candidate.pragma('integrity_check', {simple:true}) !== 'ok' || (candidate.pragma('foreign_key_check') as unknown[]).length) throw new BadRequestException('备份数据库完整性校验失败');
    if (this.schema(candidate) !== this.schema(this.db) || this.version(candidate) !== meta.schemaVersion) throw new BadRequestException('备份数据库结构不匹配');
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
    try {
      const candidate = new Database(candidatePath,{readonly:true});
      try { this.inspect(candidate,meta); } finally { candidate.close(); }
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
            for (const table of ['sessions','device_sessions','pairing_codes','api_keys','oauth_grants','oauth_codes']) this.db.exec(`DELETE FROM "${table}"`);
            this.db.prepare("DELETE FROM instance_settings WHERE key IN ('backupLatest','backupLastSlot')").run();
            this.setting('backupSchedule', {frequency:'off',time:'03:00',weekday:0,retentionDays:30});
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
    } finally { rmSync(candidatePath,{force:true}); }
  }
  onModuleInit() { this.timer = setInterval(() => { void this.tick(); },30_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  // 业务时区固定日本；错过当天时刻会在当天启动后补做，持久化槽位避免重启重复。
  async tick(now = new Date()) {
    if (this.busy || this.maintenance.restoring || now.getTime() < this.retryAt) return;
    const config = this.schedule(); if (config.frequency === 'off') return;
    const japan = new Date(now.getTime()+9*3600_000), date=japan.toISOString().slice(0,10), time=japan.toISOString().slice(11,16);
    if (time < config.time || (config.frequency === 'weekly' && japan.getUTCDay() !== config.weekday) || this.readSetting('backupLastSlot') === JSON.stringify(date)) return;
    const owner = this.db.prepare('SELECT id FROM users LIMIT 1').get() as {id:string} | undefined; if (!owner) return;
    try {
      await this.create(owner.id,'automatic'); this.setting('backupLastSlot',date);
      for (const meta of this.list()) if (meta.reason !== 'before-restore' && Date.parse(meta.createdAt) < now.getTime()-config.retentionDays*86400_000) {
        rmSync(this.file(meta.id),{force:true}); rmSync(this.filePath(meta.id+'.meta'),{force:true});
      }
    } catch (error) {
      this.retryAt = now.getTime()+15*60_000;
      this.setting('backupLatest',{ok:false,at:now.toISOString(),message:(error as Error).message});
    }
  }
}
