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
import { WalletsModule } from '../wallets/wallets.module';
import { StyleLibraryModule } from '../style-library/style-library.module';

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
    ]),
    WalletsModule,
    StyleLibraryModule,
  ],
  controllers: [ProductsController, DiscountController, CollectionController],
  providers: [JwtService, ProductService, DiscountService, CollectionService],
  exports: [JwtService, ProductService, DiscountService, CollectionService, MongooseModule],
})
export class ProductModule {}
