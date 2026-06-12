import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SelectedShippingDto {
  @ApiProperty({
    description: 'Business/vendor ID this shipping selection is for',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @IsNotEmpty()
  business_id: string;

  @ApiProperty({
    description: 'Shipbubble rate request token from checkout-preview',
    example: 'req_abc123',
  })
  @IsString()
  @IsNotEmpty()
  request_token: string;

  @ApiProperty({
    description: 'Selected courier ID from the rates list',
    example: 'cour_456',
  })
  @IsString()
  @IsNotEmpty()
  courier_id: string;

  @ApiProperty({
    description: 'Courier service code',
    example: 'SB-STD',
  })
  @IsString()
  @IsNotEmpty()
  service_code: string;

  @ApiProperty({
    description: 'Courier display name',
    example: 'GIG Logistics',
  })
  @IsString()
  @IsNotEmpty()
  courier_name: string;

  @ApiProperty({
    description: 'Shipping fee for this vendor',
    example: 2500,
  })
  @IsNumber()
  shipping_fee: number;
}
