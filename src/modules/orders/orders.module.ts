import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';
import { Order, OrderSchema } from './schemas/orders.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Style, StyleSchema } from '../products/schemas/style.schema';
import { Fabric, FabricSchema } from '../products/schemas/fabric.schema';
import { Accessory, AccessorySchema } from '../products/schemas/accessory.schema';
import { Discount, DiscountSchema } from '../products/schemas/discount.schema';
import { Address, AddressSchema } from '../ums/schemas/address.schema';
import { BusinessEarning, BusinessEarningSchema } from '../business/schemas/business-earnings.schema';
import { JwtService } from '@nestjs/jwt';
import { TransactionService } from '../transactions/transactions.service';
import { HttpModule } from '@nestjs/axios';
import { LogisticsService } from '../logistics/logistics.service';
import { ProductService } from '../products/products.service';
import { PaymentService } from '../payment/payment.service';
import { BusinessService } from '../business/business.service';
import { PlatformService } from '../platform/platform.service';
import { CurrencyService } from '../currency/currency.service';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { Cart, CartSchema } from '../cart/schema/cart.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Style.name, schema: StyleSchema },
      { name: Fabric.name, schema: FabricSchema },
      { name: Accessory.name, schema: AccessorySchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Address.name, schema: AddressSchema },
      { name: BusinessEarning.name, schema: BusinessEarningSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Cart.name, schema: CartSchema },
    ]),
    HttpModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    JwtService,
    TransactionService,
    LogisticsService,
    ProductService,
    PaymentService,
    BusinessService,
    PlatformService,
    CurrencyService,
  ],
  exports: [
    OrderService,
    OrderValidationService,
    PriceCalculationService,
    JwtService,
    TransactionService,
    LogisticsService,
    ProductService,
    PaymentService,
    BusinessService,
    PlatformService,
    CurrencyService,
  ],
})
export class OrdersModule {}

