import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.js';

export type OwnedTable = 'bank_accounts' | 'credit_cards' | 'bills';

// 各领域服务共用的数据库访问、所有权校验与审计。
@Injectable()
export class LedgerService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  get db() { return this.database.db; }
  audit(owner: string, action: string, id: string, changes: unknown) {
    this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?)').run(randomUUID(), owner, action, id, JSON.stringify(changes), new Date().toISOString());
  }
  owned(table: OwnedTable, owner: string, id: string, active = false): Record<string, unknown> {
    const item = this.db.prepare(`SELECT * FROM ${table} WHERE id=? AND ownerId=?`).get(id, owner) as Record<string, unknown> | undefined;
    if (!item) throw new NotFoundException('记录不存在');
    if (active && item.archivedAt) throw new BadRequestException('不能选择已归档的卡片或账户');
    return item;
  }
}
