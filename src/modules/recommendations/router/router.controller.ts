import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AskConversationsService } from './ask-conversations.service';
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
    private readonly conversations: AskConversationsService,
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

    // ─── Conversation memory ───────────────────────────────────
    // Signed-in callers get a remembered thread. When they name one, the
    // stored turns are the context (not whatever the client re-sent): a
    // thread resumed from the history list has no client copy at all.
    const userId: string | undefined = req.user?.id;
    let history = dto.history;
    if (userId && dto.conversation_id) {
      history = await this.conversations.historyFor(userId, dto.conversation_id);
    }

    // ─── Execute the AI pipeline ───────────────────────────────
    const result = await this.askService.ask(
      dto.query,
      dto.userId || userId,
      dto.sessionId,
      dto.limit || 10,
      history,
    );

    let conversationId: string | null = dto.conversation_id ?? null;
    if (userId) {
      conversationId = await this.conversations.record(
        userId,
        dto.conversation_id,
        dto.query,
        result.reply ?? '',
        (result.products ?? [])
          .map((p: any) => p?.product?._id ?? p?.itemId ?? p?._id)
          .filter(Boolean),
      );
    }

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
      conversation_id: conversationId,
    };
  }

  // ─── Saved conversations ─────────────────────────────────────
  // No @Public(): a thread is personal and there is nothing to list for an
  // anonymous caller. JwtAuthGuard on the class does the rejecting.

  @Get('conversations')
  @ApiOperation({ summary: 'My saved stylist conversations, most recent first' })
  @ApiQuery({ name: 'limit', required: false })
  async listConversations(@Req() req: any, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.conversations.list(req.user.id, Number.isFinite(n) && n > 0 ? n : 30);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One saved conversation, with the products each reply showed' })
  @ApiParam({ name: 'id' })
  async getConversation(@Req() req: any, @Param('id') id: string) {
    return this.conversations.get(req.user.id, id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete one saved conversation' })
  @ApiParam({ name: 'id' })
  async deleteConversation(@Req() req: any, @Param('id') id: string) {
    return this.conversations.remove(req.user.id, id);
  }

  @Delete('conversations')
  @ApiOperation({ summary: 'Delete all my saved conversations' })
  async deleteConversations(@Req() req: any) {
    return this.conversations.removeAll(req.user.id);
  }
}
