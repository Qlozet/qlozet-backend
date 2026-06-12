import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutPreviewDto {
  @ApiPropertyOptional({
    description: 'Service type for shipping (pickup or dropoff)',
    example: 'pickup',
    default: 'pickup',
  })
  @IsOptional()
  @IsString()
  service_type?: string = 'pickup';
}

// ---- Response Schemas for Swagger ----

export class CourierRateDto {
  @ApiProperty({ example: 'cour_123' })
  courier_id: string | number;

  @ApiProperty({ example: 'GIG Logistics' })
  courier_name: string;

  @ApiProperty({ example: 'https://shipbubble.com/img/gig.png' })
  courier_image: string;

  @ApiProperty({ example: 'SB-STD' })
  service_code: string;

  @ApiProperty({ example: 2500, description: 'Shipping rate in kobo/smallest unit' })
  rate_amount: number;

  @ApiProperty({ example: '2025-12-20' })
  delivery_eta: string;

  @ApiProperty({ example: '3-5 business days' })
  delivery_eta_time: string;

  @ApiProperty({ example: 150 })
  insurance_fee: number;

  @ApiProperty({ example: 'INS_001' })
  insurance_code: string;
}

export class VendorShippingItemDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  product_id: string;

  @ApiProperty({ example: 'African Print Dress' })
  product_name: string;
}

export class VendorShippingRateDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  business_id: string;

  @ApiProperty({ example: 'Qlozet Fashion House' })
  business_name: string;

  @ApiProperty({ type: [VendorShippingItemDto] })
  items: VendorShippingItemDto[];

  @ApiProperty({ example: 'req_abc123', description: 'Shipbubble rate token (pass to create order)' })
  request_token: string;

  @ApiProperty({ type: [CourierRateDto], description: 'Available couriers for this vendor' })
  rates: CourierRateDto[];

  @ApiProperty({ example: 1800, description: 'Cheapest courier rate' })
  cheapest_rate: number;

  @ApiProperty({ example: 3200, description: 'Fastest courier rate' })
  fastest_rate: number;
}

export class CheckoutPreviewResponseDto {
  @ApiProperty({ type: [VendorShippingRateDto], description: 'Shipping rates grouped by vendor' })
  vendor_shipping: VendorShippingRateDto[];

  @ApiProperty({ example: 4300, description: 'Sum of cheapest rates across all vendors' })
  total_shipping_fee: number;

  @ApiProperty({ example: 25000 })
  subtotal: number;

  @ApiProperty({ example: 29300, description: 'subtotal + total_shipping_fee' })
  total: number;
}

// Keep interfaces for internal use
export type CourierRate = CourierRateDto;
export type VendorShippingRate = VendorShippingRateDto;
export type CheckoutPreviewResponse = CheckoutPreviewResponseDto;
