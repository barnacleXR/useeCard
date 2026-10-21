import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { AccountsService } from './accounts.service.js';

@Controller(['api', 'api/app/v1'])
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly service: AccountsService) {}
  @Get('accounts') accounts(@Req() req: AuthRequest) { return this.service.accounts(req.ownerId); }
  @Post('accounts') createAccount(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.createAccount(req.ownerId, body); }
  @Post('accounts/order') reorderAccounts(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.reorder(req.ownerId, 'bank_accounts', body); }
  @Patch('accounts/:id') updateAccount(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.service.updateAccount(req.ownerId, id, body); }
  @Post('accounts/:id/archive') archiveAccount(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.archive(req.ownerId, 'bank_accounts', id); }
  @Get('cards') cards(@Req() req: AuthRequest) { return this.service.cards(req.ownerId); }
  @Post('cards') createCard(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.createCard(req.ownerId, body); }
  @Post('cards/order') reorderCards(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.reorder(req.ownerId, 'credit_cards', body); }
  @Patch('cards/:id') updateCard(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.service.updateCard(req.ownerId, id, body); }
  @Post('cards/:id/archive') archiveCard(@Req() req: AuthRequest, @Param('id') id: string) { return this.service.archive(req.ownerId, 'credit_cards', id); }
}
