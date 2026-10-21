import { Body, Controller, Get, Inject, Post, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { currencies } from '@ccm/shared';
import { SettingsService } from '../settings/settings.service.js';
import { OidcService } from '../oidc/oidc.service.js';
import { AuthService } from './auth.service.js';

@Controller('api')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(SettingsService) private readonly settings: SettingsService, @Inject(OidcService) private readonly oidc: OidcService) {}
  @Get('health') health() { return {ok: true, version: '2.0.0'}; }
  @Get('currencies') currencies() { return currencies; }
  @Get('auth/status') status() { const oidc = this.oidc.publicStatus(); return {...this.auth.status(), ...(oidc ? {oidc} : {})}; }
  @Post('auth/setup') setup(@Body() body: unknown, @Req() req: Request, @Res({passthrough: true}) res: Response) { return this.auth.login(body, req, res, true); }
  @Post('auth/login') login(@Body() body: unknown, @Req() req: Request, @Res({passthrough: true}) res: Response) { return this.auth.login(body, req, res); }
  @Get('auth/session') session(@Req() req: Request) { const session = this.auth.authenticate(req); return {csrf: session.csrf, ...this.settings.preferences(session.ownerId)}; }
  @Get('auth/sessions') sessions(@Req() req: Request) { return this.auth.sessions(req); }
  @Post('auth/sessions/:id/revoke') revoke(@Req() req: Request, @Param('id') id:string) { return this.auth.revoke(req,id); }
  @Post('auth/password') password(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response) { return this.auth.changePassword(body,req,res); }
  @Post('auth/logout') logout(@Req() req: Request, @Res({passthrough: true}) res: Response) { return this.auth.logout(req, res); }
}
