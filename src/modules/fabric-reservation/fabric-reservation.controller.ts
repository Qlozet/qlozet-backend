import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FabricReservationService } from './fabric-reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ClaimReservationDto } from './dto/claim-reservation.dto';
import { Public } from 'src/common/decorators/public.decorator';

@ApiTags('Fabric Reservations')
@Controller('reservations')
export class FabricReservationController {
  constructor(
    private readonly reservationService: FabricReservationService,
  ) {}

  // ─── Organizer Endpoints ──────────────────────────────────────

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a fabric reservation (organizer)' })
  @ApiResponse({
    status: 201,
    description: 'Reservation created. Returns Paystack payment URL for fee.',
  })
  async createReservation(
    @Body() dto: CreateReservationDto,
    @Req() req: any,
  ) {
    return this.reservationService.createReservation(dto, req.user);
  }

  @Get('my')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my reservations (organizer)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  async getMyReservations(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('size') size?: number,
  ) {
    return this.reservationService.getMyReservations(
      req.user.id,
      page || 1,
      size || 10,
    );
  }

  @Get(':id/claims')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get claims for a reservation (organizer)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  async getReservationClaims(
    @Param('id') id: string,
    @Req() req: any,
    @Query('page') page?: number,
    @Query('size') size?: number,
  ) {
    return this.reservationService.getReservationClaims(
      id,
      req.user.id,
      page || 1,
      size || 10,
    );
  }

  @Patch(':id/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a reservation (organizer)' })
  @ApiResponse({
    status: 200,
    description: 'Reservation cancelled. Unclaimed yards released.',
  })
  async cancelReservation(@Param('id') id: string, @Req() req: any) {
    return this.reservationService.cancelReservation(id, req.user.id);
  }

  // ─── Public / Guest Endpoints ─────────────────────────────────

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get reservation details (public — guest link)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reservation details with progress and fabric info.',
  })
  async getReservationDetails(@Param('id') id: string) {
    return this.reservationService.getReservationDetails(id);
  }

  @Post(':id/claim')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim yards from a reservation (guest)' })
  @ApiResponse({
    status: 201,
    description: 'Claim created. Returns Paystack payment URL.',
  })
  async claimFromReservation(
    @Param('id') id: string,
    @Body() dto: ClaimReservationDto,
    @Req() req: any,
  ) {
    return this.reservationService.claimFromReservation(id, dto, req.user);
  }
}
