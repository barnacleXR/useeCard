import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../database.js';
import type { AuthRequest } from './auth.service.js';
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'日期无效');
const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),action:z.string().max(100).optional(),source:z.enum(['unknown','web','ios','rest','mcp','system']).optional(),outcome:z.enum(['success','failure','rate_limited']).optional(),search:z.string().trim().max(100).optional(),from:day.optional(),to:day.optional()}).refine(v=>!v.from||!v.to||v.from<=v.to,'开始日期不能晚于结束日期');
// 密码、令牌与图片内容永远不在审计详情中展示。
function redact(value:unknown):unknown {
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|token|csrf|hash|secret|base64|^data$|last4|contactEmail|^url$/i.test(key)).map(([key,v])=>[key,redact(v)]));
  return value;
}
@Controller('api/audit')
export class AuditController {
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService){}
  @Get() list(@Req() req:AuthRequest,@Query() raw:unknown){
    const q=query.parse(raw),where=['ownerId=?'],args:(string|number)[]=[req.ownerId];
    if(q.action){where.push('action=?');args.push(q.action);}
    if(q.source){where.push('source=?');args.push(q.source);}
    if(q.outcome){where.push('outcome=?');args.push(q.outcome);}
    if(q.search){where.push('(action LIKE ? ESCAPE \'\\\' OR entityId LIKE ? ESCAPE \'\\\' OR ip LIKE ? ESCAPE \'\\\')');const term='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%';args.push(term,term,term);}
    // 日期筛选以日本自然日为界，与账单与提醒保持一致。
    if(q.from){where.push('createdAt>=?');args.push(new Date(q.from+'T00:00:00+09:00').toISOString());}
    if(q.to){where.push('createdAt<?');args.push(new Date(Date.parse(q.to+'T00:00:00+09:00')+86400000).toISOString());}
    const db=this.database.db;
    return db.transaction(()=>{
      const total=(db.prepare(`SELECT count(*) AS n FROM audit_events WHERE ${where.join(' AND ')}`).get(...args) as {n:number}).n;
      const rows=db.prepare(`SELECT id,action,entityId,changes,createdAt,source,outcome,authMethod,ip,userAgent,location FROM audit_events WHERE ${where.join(' AND ')} ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?`).all(...args,q.pageSize,(q.page-1)*q.pageSize) as {changes:string}[];
      const actions=(db.prepare('SELECT DISTINCT action FROM audit_events WHERE ownerId=? ORDER BY action').all(req.ownerId) as {action:string}[]).map(v=>v.action);
      return {items:rows.map(row=>({...row,changes:redact(JSON.parse(row.changes))})),total,page:q.page,pageSize:q.pageSize,actions};
    })();
  }
}
