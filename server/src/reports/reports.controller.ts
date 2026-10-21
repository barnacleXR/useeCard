import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { ReportsService } from './reports.service.js';

@Controller(['api', 'api/app/v1'])
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}
  @Get('summary') summary(@Req() req: AuthRequest, @Query('dueMonth') month: string, @Query('currency') currency?: string) { return this.service.summary(req.ownerId, month, currency); }
  @Get('calendar') calendar(@Req() req: AuthRequest, @Query('dueMonth') month: string, @Query('currency') currency?: string) { return this.service.calendar(req.ownerId, month, currency); }
  @Get('reports/monthly') report(@Req() req: AuthRequest, @Query('dueMonth') month: string, @Query('currency') currency?: string) { return this.service.monthlyReport(req.ownerId, month, currency); }
}
