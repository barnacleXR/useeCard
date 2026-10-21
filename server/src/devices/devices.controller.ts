import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { DevicesService } from './devices.service.js';

// Web 管理：生成配对码、查看与撤销已登录设备。只接受 Web 会话。
@Controller('api/devices')
export class DevicesController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService) {}
  @Get() list(@Req() req: AuthRequest) { return this.devices.list(req.ownerId); }
  @Post('pairing-codes') createPairingCode(@Req() req: AuthRequest) { return this.devices.createPairingCode(req.ownerId); }
  @Post(':id/revoke') revoke(@Req() req: AuthRequest, @Param('id') id: string) { return this.devices.revoke(req.ownerId, id); }
}
