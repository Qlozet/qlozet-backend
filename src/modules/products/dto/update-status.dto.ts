// dto/update-status.dto.ts
import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsMongoId,
} from 'class-validator';
import {
  BULK_PRODUCT_ACTIONS,
  BulkProductAction,
  MAX_BULK_PRODUCTS,
} from '../bulk-actions';

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

export class BulkProductActionDto {
  @ApiProperty({ type: [String], description: 'Up to 100 of your product ids' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Pick at least one product.' })
  @ArrayMaxSize(MAX_BULK_PRODUCTS, {
    message: 'Pick up to ' + MAX_BULK_PRODUCTS + ' products at a time.',
  })
  @IsMongoId({ each: true })
  product_ids: string[];

  @ApiProperty({ enum: BULK_PRODUCT_ACTIONS })
  @IsIn(BULK_PRODUCT_ACTIONS as unknown as string[])
  action: BulkProductAction;
}
