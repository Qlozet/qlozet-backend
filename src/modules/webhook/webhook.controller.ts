import { Controller, Post, Req } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}
  @Public()
  @Post('paystack/webhook')
  @ApiOperation({ summary: 'Handle Paystack webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received successfully' })
  async handlePaystackWebhook(@Req() req: any) {
    return this.webhookService.handlePaystackWebhook(req.body);
  }
}
