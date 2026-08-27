import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * Payload of GET /api/admin/me/overview — the admin console's profile drawer.
 *
 * Split into `stats` (the marketplace this admin oversees) and `metrics` (this
 * admin's own workload) so that, e.g., `stats.vendors` and
 * `metrics.vendorsManaged` cannot be mistaken for each other.
 */
export class AdminProfileStatsDto {
  @ApiProperty({ example: 402, description: "Every user of type 'customer'" })
  customers: number;

  @ApiProperty({ example: 24, description: 'Every registered business' })
  vendors: number;

  @ApiProperty({
    example: 20,
    description:
      "Tickets assigned to THIS admin that reached 'resolved' or 'closed' within the task window. Narrower than metrics.ticketsResolved, which is all-time.",
  })
  tasksCompleted: number;

  @ApiProperty({
    example: 137,
    description:
      "Platform-wide tickets in 'resolved' or 'closed', all-time and across every admin",
  })
  ticketsClosed: number;
}

export class AdminProfileMetricsDto {
  @ApiProperty({
    example: 20,
    description:
      'Distinct vendors this admin has been assigned a ticket for. No business carries an assigned account manager, so this is handled-vendors rather than a formal assignment.',
  })
  vendorsManaged: number;

  @ApiProperty({
    example: 100,
    description:
      "Tickets assigned to THIS admin in 'resolved' or 'closed', all-time",
  })
  ticketsResolved: number;

  @ApiProperty({
    example: 1250000,
    description:
      'Platform gross sales in naira — the same figure as GET /admin/dashboard.gross_sales, taken before refunds, commission and payouts.',
  })
  totalSalesOversight: number;
}

/**
 * One row of the drawer's task list. A "task" is an assigned support ticket:
 * this backend has no task or audit-log collection, and tickets are the only
 * work it actually assigns to an admin.
 */
export class AdminProfileTaskDto {
  @ApiProperty({ example: '6a42dd1d1ef94a89f9f04679' })
  id: string;

  @ApiProperty({
    example: 'Payout not received',
    description: "The ticket's issue_type — its headline, not the description",
  })
  title: string;

  @ApiProperty({
    example: 'Ankara Bliss',
    nullable: true,
    description: 'Vendor the ticket was raised for; null when unresolvable',
  })
  vendor: string | null;

  @ApiProperty({
    example: 'pending',
    enum: ['completed', 'pending'],
    description:
      "'completed' for a resolved/closed ticket, 'pending' for open/in_progress — the drawer's Completed / Pending tabs.",
  })
  status: 'completed' | 'pending';

  @ApiProperty({
    example: '2026-08-22T09:31:00.000Z',
    description:
      'When the ticket was raised; the client renders it as "5d ago"',
  })
  at: Date;
}

export class AdminProfileOverviewDto {
  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({
    example: 30,
    description:
      'How many days back `tasks` and `stats.tasksCompleted` look — the design\'s "Task Last Month"',
  })
  taskWindowDays: number;

  @ApiProperty({ type: AdminProfileStatsDto })
  stats: AdminProfileStatsDto;

  @ApiProperty({ type: AdminProfileMetricsDto })
  metrics: AdminProfileMetricsDto;

  @ApiProperty({
    type: [AdminProfileTaskDto],
    description:
      'This admin’s assigned tickets from the task window, newest first',
  })
  tasks: AdminProfileTaskDto[];
}

export class AdminProfileOverviewWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminProfileOverviewDto })
  data: AdminProfileOverviewDto;
}
