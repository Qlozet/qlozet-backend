import { Body, Controller, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WebhookService } from './webhook.service';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}
  @Public()
  @Post('paystack')
  @ApiOperation({ summary: 'Handle Paystack webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received successfully' })
  async handlePaystackWebhook(@Req() req: any) {
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

