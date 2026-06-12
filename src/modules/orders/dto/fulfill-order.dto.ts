import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FulfillOrderDto {
  @ApiPropertyOptional({
    description: 'Override the courier ID from the original rate quote',
    example: 'cour_456',
  })
  @IsOptional()
  @IsString()
  courier_id?: string;

  @ApiPropertyOptional({
    description: 'Override the service code from the original rate quote',
    example: 'SB-STD',
  })
  @IsOptional()
  @IsString()
  service_code?: string;
}
