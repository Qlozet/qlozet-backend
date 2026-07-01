import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SystemCategory,
  SystemCategorySchema,
} from './schemas/system-category.schema';
import { SystemTag, SystemTagSchema } from './schemas/system-tag.schema';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyController } from './taxonomy.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SystemCategory.name, schema: SystemCategorySchema },
      { name: SystemTag.name, schema: SystemTagSchema },
    ]),
  ],
  controllers: [TaxonomyController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
