import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class ClaimReservationDto {
  @ApiProperty({
    description: 'Number of yards to claim from the reservation',
    example: 5,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0.1)
  yards: number;
}
