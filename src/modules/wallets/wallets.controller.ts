import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { FundWalletDto } from './wallet.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { TokenService } from './token.service';

@ApiTags('Wallets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly tokenService: TokenService,
  ) {}

  // Fund wallet
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund wallet via Paystack' })
  @ApiBody({ type: FundWalletDto })
  async fundWallet(@Body() dto: FundWalletDto, @Req() req: any) {
    const business = req.business.id;
    const user = req.user;
    const result = await this.walletsService.fundWallet(
      dto.amount,
      user.email,
      user.id,
      business,
    );
    return { message: 'Wallet funding initialized', data: result };
  }

  // Get wallet balance
  @Roles(UserType.CUSTOMER, UserType.VENDOR)
  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  async getBalance(@Req() req) {
    const business = req?.business?.id;
    const customerId = req.user.id;
    return this.walletsService.getOrCreateWallet(
      business ?? undefined,
      business ? undefined : customerId,
    );
  }

  @Get('price')
  async price(
    @Query('tokens') tokens: number,
    @Query('currency') currency: string = 'USD',
  ) {
    return this.tokenService.getTokenPurchasePrice(Number(tokens), currency);
  }
}
