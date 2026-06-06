import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CustomerWaitlistDto, VendorWaitlistDto } from './dto/waitlist.dto';
import { Public } from 'src/common/decorators/public.decorator';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Public()
  @Post('customer')
  @ApiOperation({ summary: 'Join the customer waitlist' })
  @ApiResponse({ status: 201, description: 'Successfully joined the customer waitlist.' })
  async joinCustomerWaitlist(@Body() dto: CustomerWaitlistDto) {
    return this.waitlistService.joinCustomerWaitlist(dto);
  }

  @Public()
  @Post('vendor')
  @ApiOperation({ summary: 'Join the vendor waitlist' })
  @ApiResponse({ status: 201, description: 'Successfully joined the vendor waitlist.' })
  async joinVendorWaitlist(@Body() dto: VendorWaitlistDto) {
    return this.waitlistService.joinVendorWaitlist(dto);
  }
}
