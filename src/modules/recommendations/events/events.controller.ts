import { Controller, Get, Post, Body, Query, BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Events')
@Controller('recommendations/events')
export class EventsController {
    constructor(private readonly eventsService: EventsService) { }

    @Post()
    @ApiOperation({ summary: 'Track an event' })
    async create(@Body() createEventDto: CreateEventDto) {
        return this.eventsService.logEvent(createEventDto);
    }

    @Get()
    @ApiOperation({ summary: 'List recent events for a user' })
    @ApiQuery({ name: 'userId', required: true })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'since', required: false, type: Date })
    async getRecentEvents(
        @Query('userId') userId: string,
        @Query('limit') limit?: number,
        @Query('since') since?: string,
    ) {
        if (!userId) {
            throw new BadRequestException('userId is required');
        }
        const limitNum = limit ? parseInt(limit.toString()) : 50;
        const sinceDate = since ? new Date(since) : undefined;
        return this.eventsService.getRecentEvents(userId, limitNum, sinceDate);
    }
}
