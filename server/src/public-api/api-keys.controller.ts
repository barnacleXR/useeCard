import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { ApiKeysService } from './api-keys.service.js';

// Web 管理：创建、查看与撤销 API Key。只接受 Web 会话，API Key 本身不能管理 Key。
@Controller('api/api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}
  @Get() list(@Req() req: AuthRequest) { return this.keys.list(req.ownerId); }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) { return this.keys.create(req.ownerId, body); }
  @Post(':id/revoke') revoke(@Req() req: AuthRequest, @Param('id') id: string) { return this.keys.revoke(req.ownerId, id); }
}
