import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
    imports: [ConfigModule, CatalogModule],
    providers: [EmbeddingsService],
    exports: [EmbeddingsService],
})
export class EmbeddingsModule { }
