import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Product, ProductDocument } from '../../products/schemas/product.schema';

@Injectable()
export class CatalogBackfillService {
    private readonly logger = new Logger(CatalogBackfillService.name);

    constructor(
        @InjectModel(Product.name) private productModel: Model<ProductDocument>,
        private eventEmitter: EventEmitter2,
    ) {}

    /**
     * Backfill the recommendation catalog from existing products.
     * Emits product.upserted for each active product, which triggers
     * CatalogSyncListener to create/update the catalog item.
     */
    async backfillAll(): Promise<{ synced: number; skipped: number; errors: number }> {
        this.logger.log('Starting catalog backfill from products collection...');

        const products = await this.productModel
            .find({ status: 'active' })
            .lean()
            .exec();

        let synced = 0;
        let skipped = 0;
        let errors = 0;

        for (const product of products) {
            try {
                this.eventEmitter.emit('product.upserted', product);
                synced++;
            } catch (e) {
                this.logger.error(`Failed to sync product ${product._id}: ${e.message}`);
                errors++;
            }
        }

        this.logger.log(`Catalog backfill complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);
        return { synced, skipped, errors };
    }
}
