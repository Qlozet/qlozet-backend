import { Controller, Post, Body, Query } from '@nestjs/common';
import { RouterService } from './router.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Recommendations')
@Controller('recommendations')
export class RouterController {
    constructor(private readonly routerService: RouterService) { }

    @Post('recommend')
    @ApiOperation({ summary: 'Get recommendations for a user' })
    async recommend(@Body() body: any) {
        const { userId, ...context } = body;
        return this.routerService.recommend(userId, context);
    }
}
