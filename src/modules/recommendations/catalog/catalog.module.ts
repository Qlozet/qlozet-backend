import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogItem, CatalogItemSchema } from './schemas/catalog-item.schema';
import { CatalogSyncListener } from './catalog-sync.listener';
import { CatalogBackfillService } from './catalog-backfill.service';
import { Product, ProductSchema } from '../../products/schemas/product.schema';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { RetrievalModule } from '../retrieval/retrieval.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: CatalogItem.name, schema: CatalogItemSchema },
            { name: Product.name, schema: ProductSchema },
        ]),
        forwardRef(() => EmbeddingsModule),
        forwardRef(() => RetrievalModule),
    ],
    controllers: [CatalogController],
    providers: [CatalogService, CatalogSyncListener, CatalogBackfillService],
    exports: [CatalogService, MongooseModule],
})
export class CatalogModule { }



