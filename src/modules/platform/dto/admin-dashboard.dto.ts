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
/**
 * Percentage movement over the last `period_days` versus the window before it,
 * for the console's stat-card badges.
 *
 * A field is `null` when the previous window had nothing to compare against —
 * not 0, and not "+100%": a first-ever order is not a 100% increase over
 * anything, and the card renders no badge rather than assert a trend.
 *
 * `measurement_accuracy` has no entry because the metric itself does not exist
 * on this endpoint.
 */
export class AdminDashboardChangesDto {
  @ApiProperty({
    example: 30,
    description: 'Length of the comparison window, in days',
  })
  period_days: number;

  @ApiProperty({
    example: 2.5,
    nullable: true,
    description: 'Orders created in the window, vs the window before',
  })
  total_orders: number | null;

  @ApiProperty({
    example: -1.2,
    nullable: true,
    description:
      "Orders currently 'completed' whose updatedAt falls in the window. An Order carries no per-status timestamp (delivered_at is on VendorShipment), so this is a proxy for delivery throughput rather than a measure of it.",
  })
  orders_delivered: number | null;

  @ApiProperty({
    example: 8,
    nullable: true,
    description:
      "Orders currently 'processing' whose updatedAt falls in the window. Same proxy caveat as orders_delivered.",
  })
  orders_in_transit: number | null;

  @ApiProperty({
    example: 4.3,
    nullable: true,
    description: 'Businesses created in the window',
  })
  total_vendors: number | null;

  @ApiProperty({
    example: 0,
    nullable: true,
    description:
      "Businesses currently 'verified' whose updatedAt falls in the window. Same proxy caveat as orders_delivered.",
  })
  verified_vendors: number | null;

  @ApiProperty({
    example: 12.5,
    nullable: true,
    description: "Users of type 'customer' created in the window",
  })
  total_customers: number | null;

  @ApiProperty({
    example: 6.1,
    nullable: true,
    description: 'Sum of paid order totals created in the window',
  })
  gross_sales: number | null;
}

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

  @ApiProperty({
    type: AdminDashboardChangesDto,
    description:
      'Percentage movement for the stat-card badges. The figures above remain all-time; only these are windowed.',
  })
  changes: AdminDashboardChangesDto;
}

export class AdminDashboardMetricsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminDashboardMetricsDto })
  data: AdminDashboardMetricsDto;
}
