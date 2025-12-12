import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JobStatusService } from '../measurement/job-status.service';

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly jobService: JobStatusService,
  ) {}
  @Public()
  @Post('paystack')
  @ApiOperation({ summary: 'Handle Paystack webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received successfully' })
  async handlePaystackWebhook(@Req() req: any) {
    return this.webhookService.handlePaystackWebhook(req.body);
  }

  @Public()
  @Get('job/:job_id')
  async getJobStatus(@Param('job_id') jobId: string) {
    return await this.jobService.findByJobId(jobId);
  }
}
