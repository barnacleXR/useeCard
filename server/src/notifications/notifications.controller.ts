import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { NotificationsService } from './notifications.service.js';
import { RateLimitService } from '../common/security.js';
@Controller('api/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service:NotificationsService,@Inject(RateLimitService) private readonly limiter:RateLimitService){}
  @Get() list(@Req() req:AuthRequest,@Query() query:unknown){return this.service.list(req.ownerId,query);}
  @Get('unread-count') unread(@Req() req:AuthRequest){return this.service.unread(req.ownerId);}
  @Post('read') read(@Req() req:AuthRequest,@Body() body:unknown){return this.service.read(req.ownerId,body);}
  @Post('read-all') readAll(@Req() req:AuthRequest){return this.service.readAll(req.ownerId);}
  @Post('test') test(@Req() req:AuthRequest){this.limiter.hit(`notification-test:${req.ownerId}`,5,60_000);return this.service.test(req.ownerId);}
}
