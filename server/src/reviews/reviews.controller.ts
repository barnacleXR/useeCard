import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.service.js';
import { ReviewsService } from './reviews.service.js';

@Controller(['api/reviews', 'api/app/v1/reviews'])
export class ReviewsController {
  constructor(@Inject(ReviewsService) private readonly service: ReviewsService) {}
  @Get() reviews(@Req() req: AuthRequest, @Query('reviewMonth') month: string) { return this.service.reviews(req.ownerId, month); }
  @Post(':month/start') startReview(@Req() req: AuthRequest, @Param('month') month: string) { return this.service.startReview(req.ownerId, month); }
  @Post(':month/cards') addReviewCards(@Req() req: AuthRequest, @Param('month') month: string, @Body() body: unknown) { return this.service.addReviewCards(req.ownerId, month, body); }
  @Post(':month/confirm') confirmReview(@Req() req: AuthRequest, @Param('month') month: string, @Body() body: unknown) { return this.service.confirmReview(req.ownerId, month, body); }
}
