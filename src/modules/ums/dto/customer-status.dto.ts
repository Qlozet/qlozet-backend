import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** The `status` values the User schema allows. */
export const CUSTOMER_STATUSES = ['active', 'inactive', 'suspended'] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export class UpdateCustomerStatusDto {
  @ApiProperty({
    enum: CUSTOMER_STATUSES,
    example: 'suspended',
    description:
      "The account's new state. Sign-in requires 'active', so both 'inactive' and 'suspended' lock the customer out — the difference is intent: 'inactive' for a dormant or self-closed account, 'suspended' for one an admin has acted against.",
  })
  @IsIn(CUSTOMER_STATUSES as unknown as string[])
  status: CustomerStatus;
}
