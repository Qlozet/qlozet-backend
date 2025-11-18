import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import {
  ShipmentPayload,
  ShipmentResponse,
  FetchRatePayload,
  FetchRateResponse,
  AddressDetails,
} from './dto/shipping.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';

@ApiTags('Logistics')
@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  @Public()
  @Post('rates/:serviceCodes')
  @ApiOperation({ summary: 'Fetch shipping rates for selected couriers' })
  @ApiResponse({
    status: 200,
    description: 'Rates fetched',
    type: FetchRateResponse,
  })
  fetchRates(
    @Param('serviceCodes') serviceCodes: string,
    @Body() payload: FetchRatePayload,
  ) {
    const codesArray = serviceCodes.split(',');
    return this.logisticsService.fetchRates(codesArray, payload);
  }

  @Public()
  @Post('shipment')
  @ApiOperation({ summary: 'Create a shipment' })
  @ApiBody({ type: ShipmentPayload })
  @ApiResponse({
    status: 200,
    description: 'Shipment created',
    type: ShipmentResponse,
  })
  createShipment(
    @Body()
    payload: {
      requestToken: string;
      serviceCode: string;
      courierId: string;
    },
  ) {
    // return this.logisticsService.createShipment(payload);
  }

  @Public()
  @Post('shipment/cancel/:orderId')
  @ApiOperation({ summary: 'Cancel a shipment' })
  cancelShipment(@Param('orderId') orderId: string) {
    return this.logisticsService.cancelShipment(orderId);
  }
  @Public()
  @Get('couriers')
  @ApiOperation({ summary: 'Get all couriers' })
  getCouriers() {
    return this.logisticsService.getCouriers();
  }
  @Public()
  @Post('address')
  @ApiOperation({ summary: 'Get all couriers' })
  validateAddress(@Body() address: AddressDetails) {
    return this.logisticsService.validateAddress(address);
  }
}
