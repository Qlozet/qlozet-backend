import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CartService } from './cart.service';
import {
  AddToCartDto,
  MergeCartDto,
  ReplaceCartLineDto,
  UpdateCartLineDto,
} from './dto/add-to-cart.dto';

@ApiTags('Cart')
@ApiBearerAuth('access-token')
@Controller('cart')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user cart' })
  async getCart(@Req() req) {
    return this.cartService.getCart(req.user.id);
  }

  @Post('add')
  @ApiOperation({ summary: 'Add item to cart' })
  async addToCart(@Req() req, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(
      req.user.id,
      dto.productId,
      dto.quantity,
      dto.appliedFabricId,
      dto.appliedFabricYards,
      dto.note,
      dto.selections,
      dto.appliedFabricSize,
      {
        lineKey: dto.lineKey,
        size: dto.size,
        color: dto.color,
        measurementSet: dto.measurementSet,
      },
    );
  }

  @Patch('lines/:lineId')
  @ApiOperation({
    summary: "Set one cart line's quantity",
    description: 'Lines are addressed by their own id (items[]._id). Returns the whole cart.',
  })
  async updateLine(
    @Req() req,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateCartLineDto,
  ) {
    return this.cartService.updateLine(req.user.id, lineId, dto.quantity);
  }

  @Put('lines/:lineId')
  @ApiOperation({
    summary: "Change one cart line's choices (the cart's Edit)",
    description:
      'Sends the same choices as POST /cart/add, without productId and quantity: the line keeps its product, id and quantity and is re-priced. If the new choices match another line, the two merge and this line goes. Returns the whole cart.',
  })
  async replaceLine(
    @Req() req,
    @Param('lineId') lineId: string,
    @Body() dto: ReplaceCartLineDto,
  ) {
    return this.cartService.replaceLine(req.user.id, lineId, dto);
  }

  @Delete('lines/:lineId')
  @ApiOperation({
    summary: 'Remove one cart line',
    description:
      'Removes exactly that line, not every line of the same product. Removing a line that is already gone succeeds. Returns the whole cart.',
  })
  async removeLine(@Req() req, @Param('lineId') lineId: string) {
    return this.cartService.removeLine(req.user.id, lineId);
  }

  @Post('merge')
  @ApiOperation({
    summary: 'Move a guest cart into the account (once, at sign-in)',
    description:
      'Adds each guest line the account does not already have. A line already in the account is left as it is, so running the merge twice adds nothing. Returns the cart and the product ids that could not be added.',
  })
  async mergeGuestCart(@Req() req, @Body() dto: MergeCartDto) {
    return this.cartService.mergeGuestCart(req.user.id, dto.items);
  }

  @Delete('/remove/:productId')
  @ApiOperation({
    summary: 'Remove every line of a product (legacy)',
    description: 'Kept for older clients. Use DELETE /cart/lines/:lineId to remove one line.',
  })
  async removeItem(@Req() req, @Param('productId') productId: string) {
    return this.cartService.removeItem(req.user.id, productId);
  }

  @Delete('clear')
  @ApiOperation({ summary: 'Clear cart' })
  async clearCart(@Req() req) {
    return this.cartService.clearCart(req.user.id);
  }
}

