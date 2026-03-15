import { Controller, Get, Query } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';

@Controller('recommend')
export class RecommendationsController {
    constructor(private readonly recommendationsService: RecommendationsService) { }

    @Get('feed')
    async getFeed(
        @Query('userId') userId: string,
        @Query('sessionId') sessionId?: string,
        @Query('limit') limit: number = 30,
        @Query('budgetMax') budgetMax?: number,
        @Query('deadlineDays') deadlineDays?: number,
    ) {
        if (!userId) {
            return { error: 'userId required' };
        }

        return this.recommendationsService.getHomeFeed({
            userId,
            sessionId,
            limit: Number(limit),
            budgetMax: budgetMax ? Number(budgetMax) : undefined,
            deadlineDays: deadlineDays ? Number(deadlineDays) : undefined,
        });
    }

    @Get('vendors')
    async getVendorFeed(
        @Query('userId') userId: string,
        @Query('limit') limit: number = 10,
        @Query('productsPerVendor') productsPerVendor: number = 3,
    ) {
        if (!userId) {
            return { error: 'userId required' };
        }

        return this.recommendationsService.getVendorFeed({
            userId,
            limit: Number(limit),
            productsPerVendor: Number(productsPerVendor),
        });
    }

    @Get('trending')
    async getTrending(
        @Query('limit') limit: number = 30,
    ) {
        return this.recommendationsService.getTrendingFeed({
            limit: Number(limit),
        });
    }

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
        @Query('itemIds') itemIds: string,
        @Query('userId') userId?: string,
        @Query('limit') limit: number = 10,
    ) {
        if (!itemIds) {
            return { error: 'itemIds required' };
        }

        const itemIdArray = itemIds.split(',').map(id => id.trim());

        return this.recommendationsService.getCompleteTheLook({
            itemIds: itemIdArray,
            userId,
            limit: Number(limit),
        });
    }
}
