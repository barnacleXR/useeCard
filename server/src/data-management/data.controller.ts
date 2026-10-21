import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.service.js';
import { BackupService } from './backup.service.js';
import { ExportService } from './export.service.js';

// 当前实例只有一个管理员；完整备份与恢复仅开放给 Web 的已登录管理员。
@Controller('api/data')
export class DataController {
  constructor(@Inject(BackupService) private readonly backups: BackupService, @Inject(ExportService) private readonly exports: ExportService) {}
  @Get('export.json') json(@Req() req: AuthRequest, @Res() res: Response) {
    res.attachment('ccm-business.json').type('json').send(JSON.stringify(this.exports.json(req.ownerId),null,2));
  }
  @Get('bills.csv') csv(@Req() req: AuthRequest, @Res() res: Response) { res.attachment('ccm-bills.csv').type('text/csv; charset=utf-8').send(this.exports.csv(req.ownerId)); }
  @Get('backups') status() { return this.backups.status(); }
  @Post('backups') create(@Req() req: AuthRequest) { return this.backups.create(req.ownerId); }
  @Get('backups/:id') download(@Param('id') id: string, @Res() res: Response) { res.download(this.backups.file(id),id); }
  @Post('schedule') schedule(@Req() req: AuthRequest, @Body() body: unknown) { return this.backups.saveSchedule(req.ownerId,body); }
  @Post('restore') restore(@Req() req: AuthRequest, @Body() body: unknown) { return this.backups.restore(req.ownerId,body); }
}
