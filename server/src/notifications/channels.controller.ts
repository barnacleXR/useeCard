import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { RateLimitService } from '../common/security.js';
import { AppriseService } from './apprise.service.js';
@Controller('api/notification-channels')
export class ChannelsController {
  constructor(@Inject(AppriseService) private readonly service:AppriseService,@Inject(RateLimitService) private readonly limiter:RateLimitService){}
  @Get() state(@Req() req:AuthRequest){return this.service.state(req.ownerId);}
  @Post() create(@Req() req:AuthRequest,@Body() body:unknown){return this.service.create(req.ownerId,body);}
  @Patch(':id') update(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.update(req.ownerId,id,body);}
  @Post(':id/remove') remove(@Req() req:AuthRequest,@Param('id') id:string,@Body() body:unknown){return this.service.update(req.ownerId,id,body,true);}
  @Post('test') test(@Req() req:AuthRequest,@Body() body:unknown){this.limiter.hit(`apprise-test:${req.ownerId}`,5,60_000);return this.service.test(req.ownerId,body);}
  @Post('deliveries/:id/retry') retry(@Req() req:AuthRequest,@Param('id') id:string){this.limiter.hit(`apprise-retry:${req.ownerId}`,5,60_000);return this.service.retry(req.ownerId,id);}
}
