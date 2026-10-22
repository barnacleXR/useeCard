import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { PushService } from './push.service.js';
@Controller('api/push')
export class PushController {
  constructor(@Inject(PushService) private readonly push:PushService){}
  @Get() state(@Req() req:AuthRequest){return this.push.state(req.ownerId);}
  @Post() subscribe(@Req() req:AuthRequest,@Body() body:unknown){return this.push.subscribe(req.ownerId,body);}
  @Delete(':id') unsubscribe(@Req() req:AuthRequest,@Param('id') id:string){return this.push.unsubscribe(req.ownerId,id);}
}
