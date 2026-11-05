import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SERVICE_AGREEMENT } from '../business/service-agreement';
import { getVendorAgreement } from '../business/agreements';

/**
 * The vendor agreement, readable by anyone: before signing up, from the
 * website, or by a lawyer. Same text and versions the vendor console serves
 * (GET /verification/service-agreement), so the public page and what a
 * vendor accepts can never differ.
 */
@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  @Public()
  @Get('vendor-agreement')
  @ApiOperation({ summary: 'The vendor agreement in force (or ?version=)' })
  vendorAgreement(@Query('version') version?: string) {
    const wanted = version?.trim() || SERVICE_AGREEMENT.VERSION;
    const body = getVendorAgreement(wanted);
    if (!body) {
      throw new BadRequestException(`No agreement published for "${wanted}".`);
    }
    return {
      version: wanted,
      current: wanted === SERVICE_AGREEMENT.VERSION,
      body,
    };
  }
}
