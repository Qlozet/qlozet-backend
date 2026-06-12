import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEmbeddingsService } from './user-embeddings.service';
import {
  UserEmbedding,
  UserEmbeddingSchema,
} from './schemas/user-embedding.schema';
import { EventsModule } from '../events/events.module';
import { UmsModule } from '../../ums/ums.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEmbedding.name, schema: UserEmbeddingSchema },
    ]),
    DatabaseModule, EventsModule, UmsModule, EmbeddingsModule, CatalogModule,
  ],
  providers: [UserEmbeddingsService],
  exports: [UserEmbeddingsService],
})
export class UserEmbeddingsModule {}
