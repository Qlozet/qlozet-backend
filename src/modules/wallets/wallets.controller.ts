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
  UsePipes,
  ValidationPipe,
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
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { UserType } from '../ums/schemas';
import { VendorRole } from '../ums/schemas/role.schema';
import { TokenService } from './token.service';
import { PaymentService } from '../payment/payment.service';
import { NairaGatewayService } from '../payment/naira-gateway.service';
import { TransactionService } from '../transactions/transactions.service';
import { WithdrawDto } from './dto/withdraw.dto';
import {
  CreateTransferRecipientDto,
  VerifyBankAccountDto,
} from '../payment/dto/payment.dto';
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
    private readonly nairaGateway: NairaGatewayService,
    private readonly transactionService: TransactionService,
  ) {}

  // Fund wallet. Customers fund their own wallet (they bypass the vendor-role
  // check below). For a vendor business wallet, only the OWNER and OPERATIONS
  // roles may move money — other team members (tailor, marketing, support,
  // sales, data analyst) are blocked.
  @Roles(UserType.CUSTOMER, UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fund wallet by card (Paystack or Flutterwave)' })
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

  // Verify a top-up after the customer returns from Paystack or Flutterwave
  @Get('verify/:reference')
  @ApiOperation({ summary: 'Verify a wallet top-up and credit the wallet' })
  @ApiParam({ name: 'reference', description: 'Transaction reference' })
  @ApiOkResponse({
    description: 'Payment verification result. Wallet is credited if status is success.',
    type: VerifyPaymentResponseDto,
  })
  async verifyPayment(@Param('reference') reference: string) {
    const result = await this.nairaGateway.verify(reference);

    // Credit once. The webhook credits through the same flag, so whichever of
    // the two arrives first does it and the other skips (checking
    // alreadyProcessed alone let both credit when the redirect came first).
    if (result.status === 'success' && result.walletId) {
      const first = await this.transactionService.claimMetadataFlag(
        reference,
        'funding_credited',
      );
      if (first) {
        try {
          await this.walletsService.creditWallet(result.walletId, result.amount);
        } catch (error) {
          // Release the flag so the webhook (or a retry) can still credit.
          await this.transactionService.attachMetadata(reference, {
            funding_credited: false,
          });
          throw error;
        }
      }
    }

    return result;
  }

  // Get wallet balance
  @Roles(UserType.CUSTOMER, UserType.VENDOR)
  // For a vendor team, the shop's money is for the people who run it; a
  // tailor's app hides the wallet. Customers are unaffected by @VendorRoles.
  @VendorRoles(
    VendorRole.OWNER,
    VendorRole.OPERATIONS,
    VendorRole.DATA_ANALYST,
    VendorRole.SALES,
  )
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

  /**
   * Vendor requests withdrawal from their wallet balance.
   * Validates minimum payout, balance, and bank account.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Vendor withdrawal from wallet to bank' })
  @ApiBody({ type: WithdrawDto })
  async requestWithdrawal(@Body() dto: WithdrawDto, @Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    if (!businessId) {
      throw new Error('Business context required for withdrawal');
    }
    return this.walletsService.requestWithdrawal(businessId, dto.amount);
  }

  // ─── Payout (bank) account ─────────────────────────────────────────────────

  // NOTE: the global response interceptor wraps whatever we return as the
  // envelope's `data`. Return the RAW payload here (no { message, data }
  // wrapper) — wrapping would make the interceptor spread `data.data`, which
  // corrupts an array into an object ("e.find is not a function" on the client).

  /** List supported banks for the payout-account picker. */
  @Roles(UserType.VENDOR)
  @Get('banks')
  @ApiOperation({ summary: 'List supported banks for payout' })
  async listBanks(@Query('currency') currency = 'NGN') {
    return this.paymentService.listBanks(currency);
  }

  /** Return the vendor's currently linked payout account (masked). */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Get('payout-account')
  @ApiOperation({ summary: 'Get the vendor’s linked payout account' })
  async getPayoutAccount(@Req() req: any) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    if (!businessId) {
      throw new Error('Business context required');
    }
    return this.paymentService.getPayoutAccount(businessId);
  }

  /** Resolve an account number → account name before linking (confirmation). */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('payout-account/resolve')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Resolve a bank account name before linking' })
  @ApiBody({ type: VerifyBankAccountDto })
  async resolvePayoutAccount(@Body() dto: VerifyBankAccountDto) {
    return this.paymentService.resolveBankAccount(dto);
  }

  /** Link (create/replace) the vendor's payout bank account. */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('payout-account')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Link a payout bank account for the vendor' })
  @ApiBody({ type: CreateTransferRecipientDto })
  async linkPayoutAccount(
    @Body() dto: CreateTransferRecipientDto,
    @Req() req: any,
  ) {
    const businessId = req.business?._id?.toString() || req.business?.id;
    if (!businessId) {
      throw new Error('Business context required');
    }
    const result = await this.paymentService.createTransferRecipient(
      businessId,
      dto,
    );
    // Object payload → safe to let the interceptor promote `message` and spread
    // the rest under `data` (see the note above the GET routes).
    return {
      message: result.message,
      data: {
        recipient_code: result.recipient_code,
        account: result.account,
      },
    };
  }
}
