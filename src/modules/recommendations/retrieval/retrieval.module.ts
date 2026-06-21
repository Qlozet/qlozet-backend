import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RetrievalService } from './retrieval.service';
import { VectorSearchService } from './vector-search.service';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseModule } from 'src/database/database.module';
import { Event, EventSchema } from '../events/schemas/event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Event.name, schema: EventSchema }]),
    CatalogModule,
    DatabaseModule,
  ],
  providers: [RetrievalService, VectorSearchService],
  exports: [RetrievalService, VectorSearchService],
})
export class RetrievalModule {}
