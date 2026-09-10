import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformService } from './platform.service';

/**
 * Public, harmless display configuration for the storefront — ONLY fields
 * that are safe for anyone to read. Platform economics (commissions, fees,
 * penalties) stay behind the admin-gated settings endpoint.
 */
@ApiTags('Config')
@Controller('config')
export class PublicConfigController {
  constructor(private readonly platformService: PlatformService) {}

  @Public()
  @Get('public')
  @ApiOperation({
    summary: 'Public storefront display config',
    description:
      'Delivery-estimate transit buffer used by the PDP ("Estimated delivery" range). Add future public display knobs here rather than exposing the settings document.',
  })
  async getPublicConfig() {
    const s: any = await this.platformService.getSettings();
    return {
      message: 'Public config',
      data: {
        delivery_transit_min_days: s?.delivery_transit_min_days ?? 2,
        delivery_transit_max_days: s?.delivery_transit_max_days ?? 5,
        max_quote_vendors_per_design: s?.max_quote_vendors_per_design ?? 5,
      },
    };
  }
}
