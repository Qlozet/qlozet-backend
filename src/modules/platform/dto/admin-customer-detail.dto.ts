import { ApiProperty } from '@nestjs/swagger';
import { BaseResponseDto } from 'src/common/dto/base-response.dto';

/**
 * Payload of GET /api/admin/customer/:id — the admin console's customer
 * detail header.
 *
 * snake_case throughout, like every other endpoint in this backend. The admin
 * app reads these keys verbatim, so the spelling here is part of the contract.
 *
 * Every count and money figure is a NUMBER, 0 included: a customer with no
 * orders has zero orders, which is a fact about them, and rendering that as a
 * dash would claim the figure is unknown. Only a field with no source at all
 * (a name half that `full_name` does not carry, a login that predates
 * `last_login_at`) is null.
 */
export class AdminCustomerAddressDto {
  @ApiProperty({
    example: 'Lagos',
    nullable: true,
    description: 'State on the default address; null when it is not set',
  })
  state: string | null;

  @ApiProperty({
    example: 'Ikeja',
    nullable: true,
    description: 'City on the default address; null when it is not set',
  })
  city: string | null;
}

export class AdminCustomerDetailDto {
  @ApiProperty({ example: '6a4a085a4ba435c95283926c' })
  _id: string;

  @ApiProperty({ example: 'John Doe' })
  full_name: string;

  @ApiProperty({
    example: 'John',
    nullable: true,
    description:
      'First whitespace-separated token of `full_name` — the schema stores one name field, not two. Null when `full_name` is empty.',
  })
  first_name: string | null;

  @ApiProperty({
    example: 'Doe',
    nullable: true,
    description:
      'Everything after the first token of `full_name`. Null for a single-word name.',
  })
  last_name: string | null;

  @ApiProperty({ example: 'johndoe', nullable: true })
  username: string | null;

  @ApiProperty({ example: 'customer@example.com' })
  email: string;

  @ApiProperty({
    example: '+2348148972345',
    nullable: true,
    description: 'The schema field is `phone_number`; exposed here as `phone`.',
  })
  phone: string | null;

  @ApiProperty({ example: 'male', nullable: true })
  gender: string | null;

  @ApiProperty({ example: 'active', enum: ['active', 'inactive', 'suspended'] })
  status: string;

  @ApiProperty({ example: 'https://...', nullable: true })
  profile_picture: string | null;

  @ApiProperty({
    type: AdminCustomerAddressDto,
    description:
      'State and city of the default address (most recent one when none is flagged default). Always an object so the console can read `address.state` without a guard; its members are null when there is no address on file.',
  })
  address: AdminCustomerAddressDto;

  @ApiProperty({
    example: 'Ikeja, Lagos',
    nullable: true,
    description:
      'Convenience "city, state" string built from `address`. Null when neither is set.',
  })
  location: string | null;

  @ApiProperty({
    example: '2026-07-05T00:00:00.000Z',
    description:
      'When the account was created. `timestamps: true` sets this on every document, so in practice it is always present.',
  })
  created_at: Date | null;

  @ApiProperty({
    example: '2026-08-26T09:12:00.000Z',
    nullable: true,
    description:
      'Stamped on every successful sign-in. Null for an account that has not signed in since the field was introduced.',
  })
  last_login_at: Date | null;

  @ApiProperty({
    example: 14,
    description: 'Every order this customer placed, paid or not',
  })
  total_orders: number;

  @ApiProperty({
    example: '2026-08-15T09:31:00.000Z',
    nullable: true,
    description: 'createdAt of their most recent order; null when they have none',
  })
  last_order_at: Date | null;

  @ApiProperty({
    example: 20,
    description:
      'Product ratings this customer authored. Ratings are embedded in `products.ratings[]`, one entry per product per user.',
  })
  reviews_count: number;

  @ApiProperty({
    example: 3,
    description: 'Length of the user\'s `following_businesses`',
  })
  followed_vendors: number;

  @ApiProperty({
    example: 1,
    description: 'Fabric reservations they organised',
  })
  reserved_fabrics: number;

  @ApiProperty({
    example: 25000,
    description: 'Wallet balance; 0 when they have no wallet yet',
  })
  wallet_balance: number;

  @ApiProperty({
    example: 0,
    description: 'Wallet pending balance; 0 when they have no wallet yet',
  })
  pending_balance: number;

  @ApiProperty({
    example: 120,
    description: 'Token balance; 0 when they have no token record yet',
  })
  token_balance: number;

  @ApiProperty({
    example: 4500,
    description:
      "Order value carrying a refund — the `total` of every order whose refund_status is 'partial' or 'refunded'. Orders record no per-refund amount, so a partial refund contributes its whole order total.",
  })
  total_returns: number;

  @ApiProperty({
    example: 486000,
    description:
      "Lifetime spend — the `total` over their PAID orders only, so an abandoned unpaid order does not inflate it.",
  })
  lifetime_spending: number;
}

export class AdminCustomerDetailWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminCustomerDetailDto })
  data: AdminCustomerDetailDto;
}

/**
 * Payload of GET /api/admin/customer/:id/transactions — the standard paginated
 * envelope this backend already returns everywhere else.
 *
 * Rows keep whatever shape TransactionService.findByCustomer returns, which is
 * the same projection the customer-facing /transactions/customer route serves.
 */
export class AdminCustomerTransactionsPageDto {
  @ApiProperty({
    type: [Object],
    description:
      'Transaction rows: _id, type, amount, status, reference, description, currency, payment_method, channel, createdAt, plus the populated order and wallet stubs.',
  })
  data: Record<string, any>[];

  @ApiProperty({ example: 42 })
  total_items: number;

  @ApiProperty({ example: 5 })
  total_pages: number;

  @ApiProperty({ example: 1 })
  current_page: number;

  @ApiProperty({ example: 10 })
  page_size: number;

  @ApiProperty({ example: true })
  has_next_page: boolean;

  @ApiProperty({ example: false })
  has_previous_page: boolean;
}

export class AdminCustomerTransactionsWrapperDto extends BaseResponseDto {
  @ApiProperty({ type: AdminCustomerTransactionsPageDto })
  data: AdminCustomerTransactionsPageDto;
}
