import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, Get, Inject, Req } from '@nestjs/common';
import { DatabaseService } from '../database.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { BillsService } from '../bills/bills.service.js';
import type { AuthRequest } from '../auth/auth.service.js';

@Controller('api/offline')
export class OfflineController {
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(AccountsService) private readonly accounts:AccountsService,@Inject(BillsService) private readonly bills:BillsService){}
  private epoch(){const db=this.database.db;db.prepare('INSERT OR IGNORE INTO instance_settings(key,value) VALUES(?,?)').run('dataEpoch',JSON.stringify(randomUUID()));return JSON.parse((db.prepare('SELECT value FROM instance_settings WHERE key=?').get('dataEpoch') as {value:string}).value) as string;}
  @Get('version') version(){return {dataEpoch:this.epoch()};}
  @Get('snapshot') snapshot(@Req() req:AuthRequest){
    const value={dataEpoch:this.epoch(),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7*86400_000).toISOString(),accounts:this.accounts.accounts(req.ownerId),cards:this.accounts.cards(req.ownerId),bills:this.bills.bills(req.ownerId)};
    if(Buffer.byteLength(JSON.stringify(value))>10*1024*1024)throw new BadRequestException('离线数据超过 10 MB，无法保存');
    return value;
  }
}
