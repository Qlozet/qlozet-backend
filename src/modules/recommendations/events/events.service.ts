import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
    constructor(@InjectModel(Event.name) private eventModel: Model<EventDocument>) { }

    private eventCounts: Record<string, number> = {};

    async logEvent(createEventDto: CreateEventDto): Promise<EventDocument> {
        // Simple Ingestion Metric Counter
        const type = createEventDto.eventType;
        this.eventCounts[type] = (this.eventCounts[type] || 0) + 1;

        // Occasionally log stats (or moved to a cron/interval)
        if (Object.values(this.eventCounts).reduce((a, b) => a + b, 0) % 100 === 0) {
            console.log(`[Event Ingestion Stats]: ${JSON.stringify(this.eventCounts)}`);
        }

        const createdEvent = new this.eventModel({
            ...createEventDto,
            timestamp: createEventDto.timestamp ? new Date(createEventDto.timestamp) : new Date(),
        });
        return createdEvent.save();
    }

    async getRecentEvents(userId: string, limit: number = 50, since?: Date): Promise<Event[]> {
        const query: any = { userId };
        if (since) {
            query.timestamp = { $gte: since };
        }
        return this.eventModel.find(query).sort({ timestamp: -1 }).limit(limit).exec();
    }
}
