import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UserSchema, User } from '../ums/schemas/user.schema';
import { Business, BusinessSchema } from '../ums/schemas/business.schema';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../ums/schemas';
import { RoleSchema } from '../ums/schemas/role.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import { ProductsController } from './products.controller';
import { ProductService } from './products.service';
import {
  Accessory,
  AccessorySchema,
  Discount,
  DiscountSchema,
  Fabric,
  FabricSchema,
  Style,
  StyleSchema,
  Taxonomy,
  TaxonomySchema,
  Variant,
  VariantSchema,
} from './schemas';
import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: Product.name,
        useFactory: () => {
          const schema = ProductSchema;
          schema.discriminator(Style.name, StyleSchema);
          schema.discriminator(Fabric.name, FabricSchema);
          schema.discriminator(Accessory.name, AccessorySchema);
          return schema;
        },
      },
      { name: Variant.name, useFactory: () => VariantSchema },
      { name: Discount.name, useFactory: () => DiscountSchema },
      { name: Style.name, useFactory: () => StyleSchema },
      { name: Taxonomy.name, useFactory: () => TaxonomySchema },
      { name: Product.name, useFactory: () => ProductSchema },
      { name: Fabric.name, useFactory: () => FabricSchema },
      { name: Accessory.name, useFactory: () => AccessorySchema },
      { name: User.name, useFactory: () => UserSchema },
      { name: Business.name, useFactory: () => BusinessSchema },
      { name: Role.name, useFactory: () => RoleSchema },
    ]),
  ],
  controllers: [ProductsController, DiscountController],
  providers: [JwtService, ProductService, DiscountService],
  exports: [DiscountService],
})
export class ProductModule {}
