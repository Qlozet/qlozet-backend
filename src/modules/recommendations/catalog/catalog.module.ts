import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogItem, CatalogItemSchema } from './schemas/catalog-item.schema';
import { CatalogSyncListener } from './catalog-sync.listener';
import { CatalogBackfillService } from './catalog-backfill.service';
import { Product, ProductSchema } from '../../products/schemas/product.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: CatalogItem.name, schema: CatalogItemSchema },
            { name: Product.name, schema: ProductSchema },
        ]),
    ],
    controllers: [CatalogController],
    providers: [CatalogService, CatalogSyncListener, CatalogBackfillService],
    exports: [CatalogService, MongooseModule],
})
export class CatalogModule { }


