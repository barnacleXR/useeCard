import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { BillsService } from './bills.service.js';

@Controller(['api/bills', 'api/app/v1/bills'])
export class BillsController {
  constructor(@Inject(BillsService) private readonly service: BillsService) {}
  @Get() bills(@Req() req: AuthRequest, @Query('dueMonth') dueMonth?: string, @Query('currency') currency?: string, @Query('status') status?: string, @Query('cardId') cardId?: string) { return this.service.bills(req.ownerId, {dueMonth, currency, status, cardId}); }
  @Get('search') search(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.search(req.ownerId, query); }
  @Post() createBill(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.createBill(req.ownerId, body, String(req.headers['idempotency-key'] || '')); }
  @Patch(':id') updateBill(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.service.updateBill(req.ownerId, id, body); }
  @Post(':id/:action') transition(@Req() req: AuthRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown) { return this.service.transition(req.ownerId, id, action, body); }
}
