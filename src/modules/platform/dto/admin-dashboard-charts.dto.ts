import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * Payload of GET /api/admin/dashboard/charts.
 *
 * Deliberately the same envelope the vendor dashboard already speaks
 * (`GET /api/orders/chart`): every chart is `{ chartType, title, series }` and
 * every series carries `{ label, value }` points. Clients that already render
 * vendor charts need no new reader for the admin ones.
 */
export class ChartPointDto {
  @ApiProperty({ example: 'Aug', description: 'X-axis / slice label' })
  label: string;

  @ApiProperty({
    example: 156921.99,
    description:
      'Naira for the money charts, an order count for the volume charts',
  })
  value: number;

  @ApiProperty({
    example: '#3d2817',
    required: false,
    description:
      'Per-point colour. Only the categorical charts set it, so that a slice keeps its colour as the ordering changes.',
  })
  color?: string;
}

export class ChartSeriesDto {
  @ApiProperty({ example: 'revenue' })
  key: string;

  @ApiProperty({ example: 'Revenue' })
  name: string;

  @ApiProperty({ example: '#3d2817', required: false })
  color?: string;

  @ApiProperty({ type: [ChartPointDto] })
  data: ChartPointDto[];
}

export class ChartDto {
  @ApiProperty({ example: 'bar', enum: ['bar', 'pie', 'stacked_bar'] })
  chartType: string;

  @ApiProperty({ example: 'Revenue by Month' })
  title: string;

  @ApiProperty({ type: [ChartSeriesDto] })
  series: ChartSeriesDto[];
}

/**
 * Expected earnings adds three fields to the standard chart envelope, because
 * the headline figure is not simply the sum of the bars.
 */
export class ExpectedEarningsChartDto extends ChartDto {
  @ApiProperty({
    example: 412500,
    description:
      'All unreleased platform commission, scheduled and unscheduled combined. This is the number to show above the chart — it is NOT the sum of the series.',
  })
  total: number;

  @ApiProperty({
    example: 84000,
    description:
      'Commission on orders that have not been delivered yet, so no release date exists and there is no month to plot it in. Included in `total`, absent from `series`.',
  })
  unscheduled: number;

  @ApiProperty({ example: 'NGN' })
  currency: string;
}

export class AdminDashboardChartsSummaryDto {
  @ApiProperty({
    example: 1560221.99,
    description: 'Sum of the revenue series — paid order totals for `year`',
  })
  revenueThisYear: number;

  @ApiProperty({
    example: 131,
    description: 'Sum of the order-count series for `year`',
  })
  ordersThisYear: number;

  @ApiProperty({
    example: 412500,
    description: 'Mirrors charts.expectedEarnings.total',
  })
  expectedEarnings: number;
}

export class AdminDashboardChartsBundleDto {
  @ApiProperty({ type: ChartDto, description: 'Twelve points, Jan–Dec' })
  revenueByMonth: ChartDto;

  @ApiProperty({ type: ChartDto, description: 'Twelve points, Jan–Dec' })
  orderCountByMonth: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      'Seven points, Sun–Sat in Africa/Lagos. All-time revenue by day of the week — the weekly-rhythm counterpart to revenueByMonth. Paid orders only.',
  })
  earningsByDay: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      'Seven points, Sun–Sat in Africa/Lagos. All-time order volume by day of the week, paid or not.',
  })
  orderCountByDay: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description: 'All-time. Every status is emitted, including at zero.',
  })
  ordersByStatus: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      "All-time. Read from the product's taxonomy audience (who the garment is for), not the buyer's profile gender.",
  })
  ordersByAudience: ChartDto;

  @ApiProperty({
    type: ChartDto,
    description:
      "All-time, top 6 states. Read from the ORDER's shipping address, not the customer's profile address.",
  })
  ordersByLocation: ChartDto;

  @ApiProperty({ type: ChartDto, description: 'All-time' })
  ordersByProductKind: ChartDto;

  @ApiProperty({ type: ExpectedEarningsChartDto })
  expectedEarnings: ExpectedEarningsChartDto;
}

export class AdminDashboardChartsDto {
  @ApiProperty({
    example: 2026,
    description:
      'The year the time series cover. Echoes the `year` query parameter, or the year of the most recent order when it was omitted.',
  })
  year: number;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({ type: AdminDashboardChartsSummaryDto })
  summary: AdminDashboardChartsSummaryDto;

  @ApiProperty({ type: AdminDashboardChartsBundleDto })
  charts: AdminDashboardChartsBundleDto;
}

export class AdminDashboardChartsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminDashboardChartsDto })
  data: AdminDashboardChartsDto;
}
