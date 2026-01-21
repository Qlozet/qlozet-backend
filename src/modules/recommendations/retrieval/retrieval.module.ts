import { Module } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { VectorSearchService } from './vector-search.service';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
    imports: [CatalogModule],
    providers: [RetrievalService, VectorSearchService],
    exports: [RetrievalService, VectorSearchService],
})
export class RetrievalModule { }
