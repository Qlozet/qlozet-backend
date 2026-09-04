import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SystemCategory,
  SystemCategorySchema,
} from './schemas/system-category.schema';
import { SystemTag, SystemTagSchema } from './schemas/system-tag.schema';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';
import { ProductModule } from '../products/products.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SystemCategory.name, schema: SystemCategorySchema },
      { name: SystemTag.name, schema: SystemTagSchema },
    ]),
    // Product model — usage counts for the admin overview (how many live
    // products reference each product_type / tag, so the UI can warn before
    // renames and block deletes of in-use entries).
    ProductModule,
  ],
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
