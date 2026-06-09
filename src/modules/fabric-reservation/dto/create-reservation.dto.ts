import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsDateString, Min } from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({
    description: 'Product ID of the fabric to reserve',
    example: '665abc123def456789012345',
  })
  @IsNotEmpty()
  @IsString()
  fabricId: string;

  @ApiProperty({
    description: 'Name of the event',
    example: 'Ade & Kemi Wedding 2026',
  })
  @IsNotEmpty()
  @IsString()
  eventName: string;

  @ApiProperty({
    description: 'Total yards to reserve from the fabric inventory',
    example: 50,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  totalYards: number;

  @ApiProperty({
    description: 'Deadline for guest claims (ISO date string)',
    example: '2026-07-15T00:00:00.000Z',
  })
  @IsNotEmpty()
  @IsDateString()
  deadline: string;
}
