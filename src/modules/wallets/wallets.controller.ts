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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { FundWalletDto } from './wallet.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { TokenService } from './token.service';
import { PaymentService } from '../payment/payment.service';
import {
  FundWalletResponseDto,
  VerifyPaymentResponseDto,
  WalletBalanceResponseDto,
  TokenPriceResponseDto,
} from './wallet-response.dto';

@ApiTags('Wallets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly tokenService: TokenService,
    private readonly paymentService: PaymentService,
  ) {}

  // Fund wallet
  @Roles(UserType.CUSTOMER, UserType.VENDOR)
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund wallet via Paystack' })
  @ApiBody({ type: FundWalletDto })
  @ApiOkResponse({
    description: 'Wallet funding initialized. Redirect the user to the authorization_url.',
    type: FundWalletResponseDto,
  })
  async fundWallet(@Body() dto: FundWalletDto, @Req() req: any) {
    const business = req.business?._id?.toString() || req.business?.id;
    const user = req.user;
    
    // RolesGuard sets req.business for vendors. If it exists, this is a vendor request.
    const customerId = business ? undefined : user.id;
    const businessId = business || undefined;

    console.log(`[WalletsController.fundWallet] business=${business}, customerId=${customerId}, businessId=${businessId}, user.id=${user.id}`);

    const result = await this.walletsService.fundWallet(
      dto.amount,
      user.email,
      customerId,
      businessId,
    );
    return { message: 'Wallet funding initialized', data: result };
  }

  // Verify payment after Paystack redirect
  @Get('verify/:reference')
  @ApiOperation({ summary: 'Verify Paystack payment and credit wallet' })
  @ApiParam({ name: 'reference', description: 'Transaction reference' })
  @ApiOkResponse({
    description: 'Payment verification result. Wallet is credited if status is success.',
    type: VerifyPaymentResponseDto,
  })
  async verifyPayment(@Param('reference') reference: string) {
    const result = await this.paymentService.verifyPaystackPayment(reference);

    // Credit wallet only if payment succeeded AND not already processed (avoids double-credit)
    if (
      result.status === 'success' &&
      result.walletId &&
      !result.alreadyProcessed
    ) {
      await this.walletsService.creditWallet(
        result.walletId,
        result.amount,
      );
    }

    return result;
  }

  // Get wallet balance
  @Roles(UserType.CUSTOMER, UserType.VENDOR)
  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiOkResponse({
    description: 'Returns the wallet object with current balance, status, and bank details.',
    type: WalletBalanceResponseDto,
  })
  async getBalance(@Req() req) {
    const business = req?.business?.id;
    const customerId = req.user.id;
    return this.walletsService.getOrCreateWallet({
      business: business ?? undefined,
      customer: business ? undefined : customerId,
    });
  }

  @Get('price')
  @ApiOperation({ summary: 'Get token purchase price in a given currency' })
  @ApiQuery({ name: 'tokens', required: true, description: 'Number of tokens to price', example: 100 })
  @ApiQuery({ name: 'currency', required: false, description: 'Target currency (default: USD)', example: 'NGN' })
  @ApiOkResponse({
    description: 'Returns the price for the requested number of tokens in the specified currency.',
    type: TokenPriceResponseDto,
  })
  async price(
    @Query('tokens') tokens: number,
    @Query('currency') currency: string = 'USD',
  ) {
    return this.tokenService.getTokenPurchasePrice(Number(tokens), currency);
  }
}
