import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SizeGuide, SizeGuideSchema } from './schemas/size-guide.schema';
import { SizeGuideService } from './size-guide.service';
import { SizeGuideController } from './size-guide.controller';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SizeGuide.name, schema: SizeGuideSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SizeGuideController],
  providers: [SizeGuideService],
  exports: [SizeGuideService],
})
export class SizeGuideModule {}
