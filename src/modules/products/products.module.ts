import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ProductsController } from './products.controller';
import { ProductService } from './products.service';
import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import {
  Product, ProductSchema,
  Clothing, ClothingSchema,
  Fabric, FabricSchema,
  Variant, VariantSchema,
  Style, StyleSchema,
  Accessory, AccessorySchema,
  Discount, DiscountSchema,
  Collection, CollectionSchema,
} from './schemas';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Clothing.name, schema: ClothingSchema },
      { name: Fabric.name, schema: FabricSchema },
      { name: Variant.name, schema: VariantSchema },
      { name: Style.name, schema: StyleSchema },
      { name: Accessory.name, schema: AccessorySchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Collection.name, schema: CollectionSchema },
      { name: Order.name, schema: OrderSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
  ],
  controllers: [ProductsController, DiscountController, CollectionController],
  providers: [JwtService, ProductService, DiscountService, CollectionService],
  exports: [JwtService, ProductService, DiscountService, CollectionService, MongooseModule],
})
export class ProductModule {}
