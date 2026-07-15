import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { RouterService } from './router.service';
import { AskService } from './ask.service';
import { GuardrailsService } from './guardrails.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AskRequestDto } from './dto/ask-request.dto';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { PlatformService } from '../../platform/platform.service';
import { TokenService } from '../../wallets/token.service';

@ApiTags('Recommendations')
@ApiBearerAuth('access-token')
@Controller('recommendations')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class RouterController {
  constructor(
    private readonly routerService: RouterService,
    private readonly askService: AskService,
    private readonly guardrailsService: GuardrailsService,
    private readonly platformService: PlatformService,
    private readonly tokenService: TokenService,
  ) {}

  @Post('recommend')
  @ApiOperation({ summary: 'Get recommendations for a user' })
  async recommend(@Body() body: any) {
    const { userId, ...context } = body;
    return this.routerService.recommend(userId, context);
  }

  @Public()
  @Post('ask')
  @ApiOperation({
    summary: 'Ask the AI fashion assistant',
    description:
      'Send a natural language query and get back a conversational reply with matching products. Auth and token cost are configurable via platform settings.',
  })
  @ApiBody({ type: AskRequestDto })
  async ask(@Body() dto: AskRequestDto, @Req() req: any) {
    const settings = await this.platformService.getSettings();

    // ─── Runtime Auth Toggle ───────────────────────────────────
    if (settings.ai_ask_requires_auth && !req.user) {
      throw new UnauthorizedException(
        'Authentication required for AI assistant. Enable it in your account settings.',
      );
    }

    // ─── Rate Limiting (by userId or IP) ───────────────────────
    const identifier = req.user?.id || req.ip || 'anonymous';
    this.guardrailsService.checkRateLimit(identifier);

    // ─── Runtime Token Gating ──────────────────────────────────
    const tokenPrice = settings.ai_ask_token_price || 0;

    if (tokenPrice > 0 && req.user) {
      const balance = await this.tokenService.balance(
        req.business?.id,
        req.user.id,
      );
      if (balance < tokenPrice) {
        throw new BadRequestException(
          `Insufficient tokens. This feature costs ${tokenPrice} tokens. Please fund your wallet.`,
        );
      }
    }

    // ─── Execute the AI pipeline ───────────────────────────────
    const result = await this.askService.ask(
      dto.query,
      dto.userId || req.user?.id,
      dto.sessionId,
      dto.limit || 10,
      dto.history,
    );

    // ─── Deduct tokens after success (only if price > 0) ──────
    if (tokenPrice > 0 && req.user) {
      await this.tokenService.spend(
        'ai_ask',
        req.business?.id,
        req.user.id,
      );
    }

    return {
      ...result,
      tokensCost: tokenPrice,
    };
  }
}
