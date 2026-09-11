import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { AssistantService } from './assistant.service';
import { AssistantDigestService } from './assistant-digest.service';
import { ChatDto } from './dto/chat.dto';

@ApiTags('Assistant')
@ApiBearerAuth('access-token')
@Controller('assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly digestService: AssistantDigestService,
  ) {}

  // Dual vendor/platform route: vendors get their store analyst, platform
  // admins get the marketplace-wide analyst (role-gated toolset).
  @Roles(UserType.VENDOR, UserType.PLATFORM)
  @Post('chat')
  @ApiOperation({ summary: 'Ask the business analyst a question' })
  async chat(@Req() req: any, @Body() dto: ChatDto) {
    const businessId = req.business?.id;
    if (!businessId) {
      return this.assistantService.adminChat(
        req.user?.id,
        dto.message,
        dto.conversation_id,
      );
    }
    return this.assistantService.chat(
      businessId,
      dto.message,
      dto.conversation_id,
      req.business?.business_name,
    );
  }

  @Roles(UserType.VENDOR, UserType.PLATFORM)
  @Post('chat/stream')
  @ApiOperation({
    summary: 'Ask the assistant with a streamed (SSE) response',
  })
  async chatStream(@Req() req: any, @Body() dto: ChatDto, @Res() res: Response) {
    if (!req.business?.id) {
      return this.assistantService.adminChatStream(
        res,
        req.user?.id,
        dto.message,
        dto.conversation_id,
      );
    }
    return this.assistantService.chatStream(
      res,
      req.business?.id,
      dto.message,
      dto.conversation_id,
      req.business?.business_name,
    );
  }

  @Roles(UserType.VENDOR, UserType.PLATFORM)
  @Get('conversations')
  @ApiOperation({ summary: 'List conversations (own scope)' })
  async conversations(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('size') size = '20',
  ) {
    if (!req.business?.id) {
      return this.assistantService.adminListConversations(
        req.user?.id,
        Number(page),
        Number(size),
      );
    }
    return this.assistantService.listConversations(
      req.business?.id,
      Number(page),
      Number(size),
    );
  }

  @Roles(UserType.VENDOR, UserType.PLATFORM)
  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a conversation with its messages' })
  async conversation(@Req() req: any, @Param('id') id: string) {
    if (!req.business?.id) {
      return this.assistantService.adminGetConversation(req.user?.id, id);
    }
    return this.assistantService.getConversation(req.business?.id, id);
  }

  // ── Weekly digest ──────────────────────────────────────────────────────────

  @Roles(UserType.VENDOR, UserType.PLATFORM)
  @Get('digest/latest')
  @ApiOperation({ summary: 'Latest weekly digest + unread count' })
  async latestDigest(@Req() req: any) {
    // Digests are vendor-scoped; the admin console gets an empty payload
    // rather than a 403 so its dashboard renders cleanly.
    if (!req.business?.id) return { digest: null, unread_count: 0 };
    return this.digestService.latest(req.business?.id);
  }

  @Roles(UserType.VENDOR)
  @Patch('digest/:id/read')
  @ApiOperation({ summary: 'Mark a digest as read' })
  async markDigestRead(@Req() req: any, @Param('id') id: string) {
    return this.digestService.markRead(req.business?.id, id);
  }

  // Admin: trigger weekly digest generation on demand (e.g. first run / testing).
  @Roles(UserType.ADMIN)
  @Post('digest/run')
  @ApiOperation({ summary: 'Generate weekly digests for all active vendors (admin)' })
  async runDigests() {
    return this.digestService.generateAll();
  }
}
