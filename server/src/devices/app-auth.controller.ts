import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currencies } from '@ccm/shared';
import type { AuthRequest } from '../auth/auth.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DevicesService } from './devices.service.js';

// 原生 App 专用入口：server-info 与 auth/* 公开，其余需设备 Bearer 令牌（见 app.ts 中间件）。
@Controller('api/app/v1')
export class AppAuthController {
  constructor(@Inject(DevicesService) private readonly devices: DevicesService, @Inject(SettingsService) private readonly settings: SettingsService, @Inject(RemindersService) private readonly reminders: RemindersService) {}
  @Get('server-info') serverInfo() { return this.devices.serverInfo(); }
  @Post('auth/login') login(@Body() body: unknown, @Req() req: Request) { return this.devices.login(body, req.ip || 'local'); }
  @Post('auth/pair') pair(@Body() body: unknown, @Req() req: Request) { return this.devices.pair(body, req.ip || 'local'); }
  @Post('auth/refresh') @HttpCode(200) refresh(@Body() body: unknown) { return this.devices.refresh(body); }
  @Post('auth/logout') @HttpCode(200) logout(@Req() req: AuthRequest) { return this.devices.revoke(req.ownerId, req.deviceId!, 'logout'); }
  @Get('me') me(@Req() req: AuthRequest) { return {...this.settings.preferences(req.ownerId), instanceId: this.devices.instanceId(), deviceId: req.deviceId}; }
  @Get('currencies') currencies() { return currencies; }
  @Get('reminders/plan') reminderPlan(@Req() req: AuthRequest) { return this.reminders.plan(req.ownerId); }
}
