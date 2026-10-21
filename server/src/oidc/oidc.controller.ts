import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, type AuthRequest } from '../auth/auth.service.js';
import { OidcService } from './oidc.service.js';

@Controller('api/auth/oidc')
export class OidcController {
  constructor(@Inject(OidcService) private readonly oidc: OidcService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Get('start') start(@Req() req: Request, @Res() res: Response) { return this.oidc.startLogin(req, res); }
  @Get('callback') callback(@Req() req: Request, @Res() res: Response) { return this.oidc.callback(req, res); }
  @Get('identity') identity(@Req() req: AuthRequest) { return this.oidc.identity(req.ownerId); }
  @Post('link') link(@Req() req: AuthRequest, @Res({passthrough: true}) res: Response) { return this.oidc.startLink(req.ownerId, this.auth.authenticate(req).id, res); }
  @Post('unlink') unlink(@Req() req: AuthRequest) { return this.oidc.unlink(req.ownerId); }
}
