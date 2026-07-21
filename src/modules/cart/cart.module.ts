import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { Cart, CartSchema } from './schema/cart.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Discount, DiscountSchema } from '../products/schemas/discount.schema';
import { PriceCalculationService } from '../orders/orders.price-calculation';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cart.name, schema: CartSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Discount.name, schema: DiscountSchema },
    ]),
  ],
  controllers: [CartController],
  providers: [CartService, PriceCalculationService],
  exports: [CartService, MongooseModule],
})
export class CartModule {}
