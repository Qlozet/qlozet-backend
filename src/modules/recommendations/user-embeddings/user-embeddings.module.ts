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
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule, EventsModule, UmsModule, EmbeddingsModule],
  providers: [UserEmbeddingsService, CatalogService],
  exports: [UserEmbeddingsService],
})
export class UserEmbeddingsModule {}
