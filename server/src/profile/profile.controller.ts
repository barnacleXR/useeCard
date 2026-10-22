import { BadRequestException, Body, Controller, Get, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { DatabaseService } from '../database.js';
import { LedgerService } from '../common/ledger.service.js';
import type { AuthRequest } from '../auth/auth.service.js';

const profileInput=z.object({displayName:z.string().trim().max(80),contactEmail:z.union([z.literal(''),z.email().max(254)])}).strict();
@Controller('api/profile')
export class ProfileController {
  constructor(@Inject(DatabaseService) private readonly database:DatabaseService,@Inject(LedgerService) private readonly ledger:LedgerService){}
  @Get() get(@Req() req:AuthRequest) {
    const row=this.database.db.prepare('SELECT username,displayName,contactEmail,avatar IS NOT NULL AS hasAvatar FROM users WHERE id=?').get(req.ownerId) as {username:string;displayName:string;contactEmail:string;hasAvatar:number};
    return {...row,emailVerified:false};
  }
  @Patch() update(@Req() req:AuthRequest,@Body() body:unknown) {
    const value=profileInput.parse(body);
    this.database.db.prepare('UPDATE users SET displayName=?,contactEmail=? WHERE id=?').run(value.displayName,value.contactEmail,req.ownerId);
    this.ledger.audit(req.ownerId,'profile.update',req.ownerId,{displayName:value.displayName,contactEmailChanged:true});
    return this.get(req);
  }
  @Get('avatar') avatar(@Req() req:AuthRequest,@Res() res:Response) {
    const row=this.database.db.prepare('SELECT avatar FROM users WHERE id=?').get(req.ownerId) as {avatar:Buffer|null};
    if(!row?.avatar){res.status(404).end();return;}
    res.type('image/webp').setHeader('Cache-Control','private, max-age=60');res.send(row.avatar);
  }
  @Post('avatar') async upload(@Req() req:AuthRequest,@Body() body:unknown) {
    const {data}=z.object({data:z.string().max(7_100_000)}).parse(body);
    const match=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
    if(!match) throw new BadRequestException('请选择 PNG、JPEG 或 WebP 图片');
    const raw=Buffer.from(match[1],'base64');
    if(raw.length>5*1024*1024) throw new BadRequestException('头像不能超过 5 MB');
    let encoded:Buffer;
    try {encoded=await sharp(raw,{limitInputPixels:25_000_000}).rotate().resize(256,256,{fit:'cover'}).webp({quality:85}).toBuffer();}
    catch {throw new BadRequestException('图片无法处理');}
    this.database.db.prepare('UPDATE users SET avatar=? WHERE id=?').run(encoded,req.ownerId);
    this.ledger.audit(req.ownerId,'profile.avatar.update',req.ownerId,{});return {ok:true};
  }
}
