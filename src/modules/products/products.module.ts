// product.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// import { Product, ProductSchema } from './schemas/product.schema';
import { UserSchema, User } from '../ums/schemas/user.schema';
import { Business, BusinessSchema } from '../ums/schemas/business.schema';
// import { ProductController } from './products.controller';
// import { ProductService } from './products.service';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../ums/schemas';
import { RoleSchema } from '../ums/schemas/role.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import { ProductController } from './products.controller';
import { ProductService } from './products.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [ProductController],
  providers: [JwtService, ProductService],
  exports: [],
})
export class ProductModule {}
