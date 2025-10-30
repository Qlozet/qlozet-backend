import { Module } from '@nestjs/common';
import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './schemas/orders.schema';
import { Permission, PermissionSchema } from '../ums/schemas/permission.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import {
  Accessory,
  AccessorySchema,
  Clothing,
  ClothingSchema,
  Discount,
  DiscountSchema,
  Fabric,
  FabricSchema,
  Product,
  ProductSchema,
  Style,
  StyleSchema,
  Variant,
  VariantSchema,
} from '../products/schemas';
import { Cart, CartSchema } from '../cart/schema/cart.schema';
import { OrderValidationService } from './orders.validation';
import { PriceCalculationService } from './orders.price-calculation';
import {
  Transaction,
  TransactionSchema,
} from '../transactions/schema/transaction.schema';
import { Address, AddressSchema } from '../ums/schemas/address.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Accessory.name, schema: AccessorySchema },
      { name: Cart.name, schema: CartSchema },
      { name: Style.name, schema: StyleSchema },
      { name: Fabric.name, schema: FabricSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Variant.name, schema: VariantSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Clothing.name, schema: ClothingSchema },
    ]),
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderValidationService, PriceCalculationService],
})
export class OrdersModule {}
