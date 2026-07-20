import { Body, Controller, Post, Req, UnauthorizedException, Logger } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebhookService } from './webhook.service';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

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
    // Verify Paystack signature
    const signature = req.headers['x-paystack-signature'];
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    if (secret && signature) {
      const hash = crypto
        .createHmac('sha512', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (hash !== signature) {
        this.logger.warn(
          '[Webhook] Invalid Paystack signature — possible spoofed request',
        );
        throw new UnauthorizedException('Invalid webhook signature');
      }
    } else if (!signature) {
      this.logger.warn(
        '[Webhook] No X-Paystack-Signature header — rejecting',
      );
      throw new UnauthorizedException('Missing webhook signature');
    }

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
    return this.webhookService.handleShipbubbleWebhook(req.body);
  }
}

