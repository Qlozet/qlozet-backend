import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { defaultStylesPrice } from './style-defaults';

/**
 * Gives made-to-order listings saved before default styles existed their
 * default_styles_price (the cheapest style of each part, until the vendor
 * picks their own). Only touches listings that do not have the field yet, so
 * later boots find nothing to do. Runs in the background; a failure only
 * logs, and the order price is right regardless (it is worked out per order).
 */
@Injectable()
export class DefaultStylesBackfill implements OnModuleInit {
  private readonly logger = new Logger(DefaultStylesBackfill.name);

  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  onModuleInit() {
    void this.run().catch((e) =>
      this.logger.warn(`Default styles backfill failed: ${e?.message ?? e}`),
    );
  }

  async run(): Promise<number> {
    const docs = await this.productModel
      .find({
        kind: 'clothing',
        'clothing.type': 'customize',
        'clothing.styles.0': { $exists: true },
        default_styles_price: { $exists: false },
      })
      .select('clothing.styles')
      .lean();
    if (!docs.length) return 0;
    await this.productModel.bulkWrite(
      docs.map((d: any) => ({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              default_styles_price: defaultStylesPrice(d.clothing?.styles),
            },
          },
        },
      })),
    );
    this.logger.log(`Set default styles price on ${docs.length} listings`);
    return docs.length;
  }
}
