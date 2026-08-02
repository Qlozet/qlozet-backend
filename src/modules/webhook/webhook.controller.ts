import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebhookService } from './webhook.service';
import { Public } from 'src/common/decorators/public.decorator';
import { RolesGuard } from 'src/common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('paystack')
  @ApiOperation({ summary: 'Handle Paystack webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received successfully' })
  async handlePaystackWebhook(@Req() req: any) {
    // Paystack signs with HMAC-SHA512 using the account secret key.
    this.verifyHmacSignature(
      req,
      req.headers['x-paystack-signature'],
      this.configService.get<string>('PAYSTACK_SECRET_KEY'),
      'Paystack',
    );

    return this.webhookService.handlePaystackWebhook(req.body);
  }

  @Public()
  @Post('shipbubble')
  @ApiOperation({ summary: 'Handle Shipbubble tracking webhook' })
  @ApiResponse({
    status: 200,
    description: 'Shipbubble webhook processed successfully',
  })
  async handleShipbubbleWebhook(@Req() req: any) {
    // Shipbubble signs with HMAC-SHA512 using the account SECRET_KEY.
    // Prefer a dedicated webhook secret; fall back to the API key.
    this.verifyHmacSignature(
      req,
      req.headers['x-ship-signature'],
      this.configService.get<string>('SHIPBUBBLE_WEBHOOK_SECRET') ||
        this.configService.get<string>('SHIPBUBBLE_API_KEY'),
      'Shipbubble',
    );

    return this.webhookService.handleShipbubbleWebhook(req.body);
  }

  // Admin-only test simulator: fire the Shipbubble webhook handler directly with
  // a synthetic payload — no HMAC signature needed. Handy for driving a shipment
  // through statuses (picked_up/in_transit/completed/cancelled) in sandbox.
  // Pass the shipment's Shipbubble order_id OR its tracking_number.
  @Roles(UserType.ADMIN)
  @UseGuards(RolesGuard)
  @ApiBearerAuth('access-token')
  @Post('shipbubble/simulate')
  @ApiOperation({ summary: 'Simulate a Shipbubble tracking webhook (admin)' })
  async simulateShipbubbleWebhook(
    @Body()
    body: { order_id?: string; tracking_number?: string; status: string },
  ) {
    return this.webhookService.handleShipbubbleWebhook({
      order_id: body.order_id,
      tracking_number: body.tracking_number,
      status: body.status,
    });
  }

  /**
   * Verify an incoming webhook's HMAC-SHA512 signature.
   * Rejects when the signature header is missing, the secret is not
   * configured, or the computed hash does not match (timing-safe compare).
   */
  private verifyHmacSignature(
    req: any,
    signature: unknown,
    secret: string | undefined,
    provider: string,
  ) {
    if (!signature || typeof signature !== 'string') {
      this.logger.warn(
        `[Webhook] Missing ${provider} signature header — rejecting`,
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

    if (!secret) {
      this.logger.error(
        `[Webhook] ${provider} webhook secret not configured — rejecting`,
      );
      throw new UnauthorizedException('Webhook verification not configured');
    }

    // Hash the exact raw bytes when available (captured in bootstrap), and
    // fall back to a re-serialized body only if the raw buffer is missing.
    const payload: Buffer =
      req.rawBody instanceof Buffer
        ? req.rawBody
        : Buffer.from(JSON.stringify(req.body));

    const hash = crypto
      .createHmac('sha512', secret)
      .update(payload)
      .digest('hex');

    const expected = Buffer.from(hash);
    const received = Buffer.from(signature);

    const valid =
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received);

    if (!valid) {
      this.logger.warn(
        `[Webhook] Invalid ${provider} signature — possible spoofed request`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}

