import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UserSchema, User } from '../ums/schemas/user.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
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
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ProductsController, DiscountController, CollectionController],
  providers: [JwtService, ProductService, DiscountService, CollectionService],
  exports: [DiscountService],
})
export class ProductModule {}
