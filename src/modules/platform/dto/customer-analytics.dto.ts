import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';
import { ChartDto } from './admin-dashboard-charts.dto';

/**
 * Payload of GET /api/admin/customer/:id/analytics.
 *
 * Same `{ chartType, title, series }` envelope as the admin dashboard and the
 * vendor dashboard, scoped to a single customer.
 */
export class CustomerAnalyticsSummaryDto {
  @ApiProperty({
    example: 14,
    description: 'Every order this customer placed, paid or not',
  })
  totalOrders: number;

  @ApiProperty({
    example: 486000,
    description:
      'Lifetime spend in naira — the order total over their PAID orders only, so an abandoned unpaid order does not inflate it.',
  })
  totalSpent: number;

  @ApiProperty({
    example: 2,
    description: "Paid orders whose refund_status is 'partial' or 'refunded'",
  })
  returnedOrders: number;

  @ApiProperty({
    example: 16.7,
    description:
      'returnedOrders as a percentage of PAID orders, to one decimal place. 0 when they have no paid orders — an order that was never paid for could not have been returned.',
  })
  returnRate: number;

  @ApiProperty({
    example: '2026-08-15T09:31:00.000Z',
    nullable: true,
    description:
      'createdAt of their most recent order; null when they have none',
  })
  lastOrderAt: Date | null;
}

export class CustomerAnalyticsChartsDto {
  @ApiProperty({
    type: ChartDto,
    description: 'Twelve points, Jan–Dec of `year`. Paid orders only.',
  })
  spendByMonth: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description: 'All-time. Accessory / Custom / Fabric / Non-Custom.',
  })
  ordersByProductKind: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      'All-time, over PAID orders. An empty series when the customer has no paid order — a 0% return rate for someone who never completed a purchase is not a fact about them.',
  })
  returnsRate: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      'All 24 hours in Africa/Lagos, from the recommendations `events` collection. NOTE: no server-side code writes to that collection — events arrive only from clients POSTing /recommendations/events — so this is a flat 24 zeroes until a client emits them.',
  })
  activityByHour: ChartDto;
}

export class CustomerAnalyticsDto {
  @ApiProperty({ example: '6a42dd1d1ef94a89f9f04679' })
  customer: string;

  @ApiProperty({
    example: 2026,
    description:
      "The year `spendByMonth` covers. Echoes the `year` query parameter, or the year of this customer's most recent order when it was omitted.",
  })
  year: number;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({
    type: CustomerAnalyticsSummaryDto,
    description: 'All-time, so the headline figures match the lifetime record',
  })
  summary: CustomerAnalyticsSummaryDto;

  @ApiProperty({ type: CustomerAnalyticsChartsDto })
  charts: CustomerAnalyticsChartsDto;
}

export class CustomerAnalyticsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: CustomerAnalyticsDto })
  data: CustomerAnalyticsDto;
}
