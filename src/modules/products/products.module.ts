import { Module } from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import { ProductsController } from './products.controller';
import { ProductService } from './products.service';

import { DiscountService } from './discount.service';
import { DiscountController } from './discount.controller';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ProductsController, DiscountController, CollectionController],
  providers: [JwtService, ProductService, DiscountService, CollectionService],
  exports: [JwtService, ProductService, DiscountService, CollectionService],
})
export class ProductModule {}
