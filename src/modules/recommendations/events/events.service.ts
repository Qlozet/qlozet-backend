import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { UserEmbedding, UserEmbeddingDocument } from '../user-embeddings/schemas/user-embedding.schema';

// Event types that affect user taste and should invalidate embedding cache
const TASTE_AFFECTING_EVENTS = new Set([
    'click_item', 'view_item', 'save_item', 'add_to_cart',
    'purchase', 'rate_item', 'not_interested', 'hide_business',
    'wishlist_add', 'preferred_aesthetic',
]);

@Injectable()
export class EventsService {
    private readonly logger = new Logger(EventsService.name);

    constructor(
        @InjectModel(Event.name) private eventModel: Model<EventDocument>,
        @InjectModel(UserEmbedding.name) private userEmbeddingModel: Model<UserEmbeddingDocument>,
    ) { }

    private eventCounts: Record<string, number> = {};

    async logEvent(createEventDto: CreateEventDto): Promise<EventDocument> {
        // Simple Ingestion Metric Counter
        const type = createEventDto.eventType;
        this.eventCounts[type] = (this.eventCounts[type] || 0) + 1;

        // Occasionally log stats (or moved to a cron/interval)
        if (Object.values(this.eventCounts).reduce((a, b) => a + b, 0) % 100 === 0) {
            this.logger.log(`[Event Ingestion Stats]: ${JSON.stringify(this.eventCounts)}`);
        }

        const createdEvent = new this.eventModel({
            ...createEventDto,
            timestamp: createEventDto.timestamp ? new Date(createEventDto.timestamp) : new Date(),
        });
        const saved = await createdEvent.save();

        // Invalidate embedding cache for taste-affecting events (fire-and-forget)
        if (TASTE_AFFECTING_EVENTS.has(type) && createEventDto.userId) {
            this.userEmbeddingModel.updateOne(
                { userId: createEventDto.userId },
                { $set: { lastUpdated: new Date(0) } },
            ).exec().catch(err => {
                this.logger.warn(`Failed to invalidate embedding cache: ${err.message}`);
            });
        }

        return saved;
    }

    async getRecentEvents(userId: string, limit: number = 50, since?: Date): Promise<Event[]> {
        const query: any = { userId };
        if (since) {
            query.timestamp = { $gte: since };
        }
        return this.eventModel.find(query).sort({ timestamp: -1 }).limit(limit).exec();
    }
}
