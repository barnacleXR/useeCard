import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { OAuthService } from './oauth.service.js';

// Web 侧：授权页确认/拒绝、客户端与已授权连接管理。只接受 Web 会话（写操作带 CSRF）。
@Controller('api/oauth')
export class OAuthController {
  constructor(@Inject(OAuthService) private readonly oauth: OAuthService) {}
  @Get('connection') connection() { return this.oauth.connectionInfo(); }
  @Get('requests/:id') request(@Param('id') id: string) { return this.oauth.pendingRequest(id); }
  @Post('requests/:id/approve') approve(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) { return this.oauth.approve(req.ownerId, id, body); }
  @Post('requests/:id/deny') deny(@Param('id') id: string) { return this.oauth.deny(id); }
  @Get('clients') clients(@Req() req: AuthRequest) { return this.oauth.listClients(req.ownerId); }
  @Post('clients') createClient(@Req() req: AuthRequest, @Body() body: unknown) { return this.oauth.createClient(req.ownerId, body); }
  @Post('clients/:id/delete') deleteClient(@Req() req: AuthRequest, @Param('id') id: string) { return this.oauth.deleteClient(req.ownerId, id); }
  @Get('grants') grants(@Req() req: AuthRequest) { return this.oauth.listGrants(req.ownerId); }
  @Post('grants/:id/revoke') revokeGrant(@Req() req: AuthRequest, @Param('id') id: string) { return this.oauth.revokeGrant(req.ownerId, id); }
}
