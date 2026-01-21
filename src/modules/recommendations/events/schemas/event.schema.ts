import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EventType } from '../enums/event-type.enum';

export type EventDocument = HydratedDocument<Event>;

@Schema({ timestamps: true, collection: 'events' })
export class Event {
    @Prop({ required: true, index: true })
    userId: string;

    @Prop({ required: true, enum: EventType })
    eventType: EventType;

    @Prop({ type: Object })
    context?: {
        surface?: string;
        requestId?: string;
        position?: number;
        stream?: string;
    };

    @Prop({ type: Object })
    metadata?: {
        reasonCodes?: string[];
        seenIds?: string[];
        query?: string;
        filters?: Record<string, any>;
        budgetMax?: number;
        deadlineDays?: number;
        dwellMs?: number;
        [key: string]: any;
    };

    @Prop({ type: Object })
    properties: Record<string, any>;

    @Prop({ index: true, default: Date.now })
    timestamp: Date;
}

export const EventSchema = SchemaFactory.createForClass(Event);
// Compound index for efficient querying of user events over time
EventSchema.index({ userId: 1, timestamp: -1 });
EventSchema.index({ sessionId: 1, timestamp: -1 });
EventSchema.index({ eventType: 1, timestamp: -1 });
EventSchema.index({ 'properties.itemId': 1, timestamp: -1 }, { sparse: true, background: true });
