import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { Event, EventSchema } from './schemas/event.schema';
import { UserEmbedding, UserEmbeddingSchema } from '../user-embeddings/schemas/user-embedding.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Event.name, schema: EventSchema },
            { name: UserEmbedding.name, schema: UserEmbeddingSchema },
        ]),
    ],
    controllers: [EventsController],
    providers: [EventsService],
    exports: [EventsService],
})
export class EventsModule { }
