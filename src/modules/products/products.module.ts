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
  Clothing,
  ClothingSchema,
  Collection,
  CollectionSchema,
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
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Variant.name, schema: VariantSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Style.name, schema: StyleSchema },
      { name: Taxonomy.name, schema: TaxonomySchema },
      { name: Product.name, schema: ProductSchema },
      { name: Fabric.name, schema: FabricSchema },
      { name: Accessory.name, schema: AccessorySchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Collection.name, schema: CollectionSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Clothing.name, schema: ClothingSchema },
    ]),
  ],
  controllers: [ProductsController, DiscountController, CollectionController],
  providers: [JwtService, ProductService, DiscountService, CollectionService],
  exports: [DiscountService],
})
export class ProductModule {}
