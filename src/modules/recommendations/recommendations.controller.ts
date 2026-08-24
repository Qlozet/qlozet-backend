import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Public } from 'src/common/decorators/public.decorator';

@Controller('recommends')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('feed')
  async getFeed(
    @Req() req: any,
    @Query('sessionId') sessionId?: string,
    @Query('limit') limit: number = 30,
    @Query('budgetMax') budgetMax?: number,
    @Query('deadlineDays') deadlineDays?: number,
    @Query('category') category?: string,
    @Query('gender') gender?: string,
    @Query('userId') userId?: string,
  ) {
    // Prefer the authenticated user; fall back to an explicit query param.
    const uid = req.user?.id ?? userId;
    if (!uid) {
      return { error: 'userId required' };
    }

    return this.recommendationsService.getHomeFeed({
      userId: uid,
      sessionId,
      limit: Number(limit),
      budgetMax: budgetMax ? Number(budgetMax) : undefined,
      deadlineDays: deadlineDays ? Number(deadlineDays) : undefined,
      category,
      gender,
    });
  }

  @Get('vendors')
  async getVendorFeed(
    @Req() req: any,
    @Query('limit') limit: number = 10,
    @Query('productsPerVendor') productsPerVendor: number = 3,
    @Query('userId') userId?: string,
  ) {
    const uid = req.user?.id ?? userId;
    if (!uid) {
      return { error: 'userId required' };
    }

    return this.recommendationsService.getVendorFeed({
      userId: uid,
      limit: Number(limit),
      productsPerVendor: Number(productsPerVendor),
    });
  }

  @Public()
  @Get('trending')
  async getTrending(@Query('limit') limit: number = 30) {
    return this.recommendationsService.getTrendingFeed({
      limit: Number(limit),
    });
  }
  @Public()
  @Get('new')
  async getNewArrivals(
    @Query('limit') limit: number = 30,
    @Query('days') days: number = 30,
  ) {
    return this.recommendationsService.getNewArrivalsFeed({
      limit: Number(limit),
      days: Number(days),
    });
  }

  @Get('bought-together')
  async getBoughtTogether(
    @Query('itemId') itemId: string,
    @Query('limit') limit: number = 10,
  ) {
    if (!itemId) {
      return { error: 'itemId required' };
    }

    return this.recommendationsService.getBoughtTogether({
      itemId,
      limit: Number(limit),
    });
  }

  @Get('complete-look')
  async getCompleteTheLook(
    @Req() req: any,
    @Query('itemIds') itemIds: string,
    @Query('userId') userId?: string,
    @Query('limit') limit: number = 10,
  ) {
    if (!itemIds) {
      return { error: 'itemIds required' };
    }

    const itemIdArray = itemIds.split(',').map((id) => id.trim());

    return this.recommendationsService.getCompleteTheLook({
      itemIds: itemIdArray,
      userId: req.user?.id ?? userId,
      limit: Number(limit),
    });
  }
}
