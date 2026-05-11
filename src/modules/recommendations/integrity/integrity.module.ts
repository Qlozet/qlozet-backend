import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { IntegrityService } from './integrity.service';
import { BusinessModule } from '../../business/business.module';
import { UserEmbeddingsModule } from '../user-embeddings/user-embeddings.module';
import { ProductModule } from '../../products/products.module';
import { CatalogItem, CatalogItemSchema } from '../catalog/schemas/catalog-item.schema';
import { EmbeddingsModule } from '../embeddings/embeddings.module'; // If needed for embedding model access

@Module({
    imports: [
        MongooseModule.forFeature([{ name: CatalogItem.name, schema: CatalogItemSchema }]),
        ScheduleModule.forRoot(), // Ensure ScheduleModule is available
        BusinessModule,
        UserEmbeddingsModule,
        ProductModule,
        EmbeddingsModule
    ],
    providers: [IntegrityService],
    exports: [IntegrityService]
})
export class IntegrityModule { }
