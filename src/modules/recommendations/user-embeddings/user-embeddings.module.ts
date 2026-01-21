import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEmbeddingsService } from './user-embeddings.service';
import { UserEmbedding, UserEmbeddingSchema } from './schemas/user-embedding.schema';
import { EventsModule } from '../events/events.module';
import { UmsModule } from '../../ums/ums.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: UserEmbedding.name, schema: UserEmbeddingSchema }]),
        EventsModule,
        UmsModule,
        EmbeddingsModule,
    ],
    providers: [UserEmbeddingsService],
    exports: [UserEmbeddingsService],
})
export class UserEmbeddingsModule { }
