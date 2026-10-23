import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { DeviceTokenService } from './device-token.service';
import { PushService, PUSH_CHANNELS } from './push.service';
import { RegisterPushTokenDto, UnregisterPushTokenDto } from './dto/push-token.dto';
import { PushApp } from './schemas/device-token.schema';

@ApiTags('Push notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('devices/push-token')
export class PushController {
  constructor(
    private readonly tokens: DeviceTokenService,
    private readonly push: PushService,
  ) {}

  private userIdOf(req: any): string {
    const id = req?.user?.id ?? req?.user?._id;
    if (!id) throw new ForbiddenException('Sign in to register this device.');
    return String(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register this device for push (after login, on app start, and whenever FCM rotates the token)',
  })
  register(@Body() dto: RegisterPushTokenDto, @Req() req: any) {
    return this.tokens.register(this.userIdOf(req), dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop pushes to this device (on logout, before the session is cleared)' })
  unregister(@Body() dto: UnregisterPushTokenDto, @Req() req: any) {
    return this.tokens.unregister(this.userIdOf(req), dto.token);
  }

  /** Development and staging only: a test push to the caller's devices. */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test push to your own devices (not available in production)' })
  async test(@Body() body: { app?: PushApp }, @Req() req: any) {
    if (process.env.NODE_ENV === 'production' && process.env.PUSH_TEST_ENABLED !== 'true') {
      throw new ForbiddenException('Test pushes are off in production.');
    }
    if (!this.push.enabled) return { message: 'Firebase is not configured on this server.', sent: 0 };
    const app = body?.app === PushApp.VENDOR ? PushApp.VENDOR : PushApp.SHOP;
    const tokens = await this.tokens.tokensFor(this.userIdOf(req), app);
    if (!tokens.length) return { message: `No ${app} devices registered for you.`, sent: 0 };
    const outcome = await this.push.sendToTokens(tokens, {
      title: 'Test from Qlozet',
      body: 'Push notifications are working on this device.',
      data: { type: 'test', category: 'system', route: '/' },
      channel: PUSH_CHANNELS.updates,
    });
    return { message: 'Test push sent.', ...outcome };
  }
}
