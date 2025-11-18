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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { JwtAuthGuard } from '../../common/guards';
import { FundWalletDto } from './wallet.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';

@ApiTags('Wallets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

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
    const business = req?.business?._id;
    const customerId = req.user.id;
    const wallet = await this.walletsService.getOrCreateWallet(
      customerId,
      business,
    );
    return {
      walletId: wallet._id,
      balance: wallet.balance,
      currency: wallet.currency,
    };
  }
}
