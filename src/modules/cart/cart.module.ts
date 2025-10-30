import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartController } from './cart.controller';
import { Role, User } from '../ums/schemas';
import { UserSchema } from '../ums/schemas/user.schema';
import { Roles } from '../../common/decorators/roles.decorator';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { Cart, CartSchema } from './schema/cart.schema';
import { Product, ProductSchema } from '../products/schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Cart.name, schema: CartSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: Roles },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
  ],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
