import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.service.js';
import { BanksService } from '../banks/banks.service.js';
import { AssetsService } from './assets.service.js';

@Controller(['api', 'api/app/v1'])
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService, @Inject(BanksService) private readonly banks: BanksService) {}
  @Get('banks') banksList(@Query('q') q?: string) { return this.banks.search(q); }
  @Post('assets') upload(@Req() req: AuthRequest, @Body() body: unknown) { return this.assets.upload(req.ownerId, body); }
  @Post('assets/fetch') fetchUrl(@Req() req: AuthRequest, @Body() body: unknown) { return this.assets.fromUrl(req.ownerId, body); }
  @Post('assets/site-icon') siteIcon(@Req() req: AuthRequest, @Body() body: unknown) { return this.assets.fromSite(req.ownerId, body); }
  // 资产按 id 不可变，可长期缓存；仅限本人读取。
  @Get('assets/:id') file(@Req() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    const {mime, data} = this.assets.file(req.ownerId, id);
    res.setHeader('Content-Type', mime); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'"); res.send(data);
  }
}
