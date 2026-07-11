// src/dto/create-order.dto.ts
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProcessedOrderItemDto } from './order-item.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SelectedShippingDto } from './selected-shipping.dto';

export enum PaymentMethod {
  PAYSTACK = 'paystack',
  WALLET = 'wallet',
}

export class CreateOrderDto {
  @ApiProperty({
    type: [ProcessedOrderItemDto],
    description: 'Array of order items',
    example: [
      {
        product_id: '507f1f77bcf86cd799439011',
        note: 'Please make it extra comfortable',
        selections: {
          style_selections: [
            {
              style_id: '507f1f77bcf86cd799439012',
            },
          ],
          fabric_selections: [
            {
              fabric_id: '507f1f77bcf86cd799439013',
              yardage: 3.5,
              quantity: 1,
            },
          ],
          color_variant_selections: [
            {
              variant_id: '507f1f77bcf86cd799439020',
              size: 'L',
              quantity: 1,
            },
          ],
          accessory_selections: [
            {
              accessory_id: '507f1f77bcf86cd799439021',
              variant_id: '507f1f77bcf86cd799439022',
              quantity: 2,
            },
          ],
        },
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProcessedOrderItemDto)
  items: ProcessedOrderItemDto[];

  @ApiPropertyOptional({
    type: [SelectedShippingDto],
    description:
      'Shipping selections per vendor from checkout-preview. When provided, creates VendorShipment entries.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedShippingDto)
  selected_shipping?: SelectedShippingDto[];

  @ApiPropertyOptional({
    description: 'Address ID to use for this order. Defaults to the default address.',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  address_id?: string;

  @ApiPropertyOptional({
    description: 'Payment method to use. Defaults to paystack (card/bank). Use wallet to pay from wallet balance.',
    enum: PaymentMethod,
    default: PaymentMethod.PAYSTACK,
    example: 'wallet',
  })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod = PaymentMethod.PAYSTACK;
}
