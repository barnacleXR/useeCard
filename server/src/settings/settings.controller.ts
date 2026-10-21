import { Body, Controller, Get, Inject, Patch, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { SettingsService } from './settings.service.js';

@Controller(['api/settings', 'api/app/v1/settings'])
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}
  @Get() settings(@Req() req: AuthRequest) { return this.service.preferences(req.ownerId); }
  @Patch() saveSettings(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.setPreferences(req.ownerId, body); }
}
