import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Business,
  BusinessSchema,
} from '../modules/business/schemas/business.schema';
import { User, UserSchema } from '../modules/ums/schemas/user.schema';
import { Role, RoleSchema } from '../modules/ums/schemas/role.schema';
import {
  Product,
  ProductSchema,
} from '../modules/products/schemas/product.schema';

@Module({
  exports: [MongooseModule],
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),

    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
})
export class DatabaseModule {}
