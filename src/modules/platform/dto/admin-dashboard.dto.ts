import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * One entry of the dashboard's best-seller roll-up.
 *
 * Products are polymorphic on `kind`, so `name` is resolved from the
 * kind-specific subdocument (clothing/accessory/fabric) and is null for a
 * product that carries none of them.
 */
export class MustPurchaseProductDto {
  @ApiProperty({
    example: '6a42dd1d1ef94a89f9f04679',
    description: 'Product id — the `_id` of the products collection document',
  })
  product_id: string;

  @ApiProperty({
    example: 'Butterfly Two-piece Dress',
    nullable: true,
    description:
      'Resolved from clothing.name / accessory.name / fabric.name; null when the product has no kind subdocument',
  })
  name: string | null;

  @ApiProperty({
    example: 9,
    description:
      'Units ordered across every order: the sum of the item quantities on the colour-variant, fabric and accessory selections. Style and add-on selections are options on a unit rather than units, so they are not counted.',
  })
  totalOrdered: number;
}

/**
 * Payload of GET /api/admin/dashboard.
 *
 * Every figure is platform-wide and all-time — the endpoint accepts no query
 * parameters, so a client's period filter cannot narrow it.
 */
export class AdminDashboardMetricsDto {
  @ApiProperty({ example: 131, description: 'Every order ever placed' })
  total_orders: number;

  @ApiProperty({
    example: 1,
    description: "Orders whose status is 'completed'",
  })
  orders_delivered: number;

  @ApiProperty({
    example: 48,
    description: "Orders whose status is 'processing'",
  })
  orders_in_transit: number;

  @ApiProperty({ example: 24, description: 'Every registered business' })
  total_vendors: number;

  @ApiProperty({
    example: 11,
    description: "Businesses whose status is 'verified'",
  })
  verified_vendors: number;

  @ApiProperty({
    example: 402,
    description:
      "Users of type 'customer' — the same population GET /api/admin/customer lists",
  })
  total_customers: number;

  @ApiProperty({
    example: 1250000,
    description:
      'Sum of the order total over every paid order, in naira. Gross: taken before refunds, platform commission and vendor payouts.',
  })
  gross_sales: number;

  @ApiProperty({
    type: [MustPurchaseProductDto],
    description: 'Top 5 products by units ordered, highest first',
  })
  must_purchase_products: MustPurchaseProductDto[];
}

export class AdminDashboardMetricsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminDashboardMetricsDto })
  data: AdminDashboardMetricsDto;
}
