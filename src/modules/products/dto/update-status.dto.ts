// dto/update-status.dto.ts
import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { ProductStatus } from '../enums/product-status.enum';

export class UpdateStatusDto {
  @ApiProperty({
    description: 'New status of the product',
    enum: ProductStatus,
  })
  @IsEnum(ProductStatus)
  status: ProductStatus;
}

export class ScheduleActivationDto {
  @ApiProperty({
    description:
      'Date and time to activate the product automatically (must be in the future)',
    example: '2025-12-10T10:00:00Z',
  })
  @IsDateString()
  activation_date: string;
}
