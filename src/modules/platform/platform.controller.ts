import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';

import { Types } from 'mongoose';
import { AdminDashboardMetricsWrapperDto } from './dto/admin-dashboard.dto';
import { AdminDashboardChartsWrapperDto } from './dto/admin-dashboard-charts.dto';
import { CustomerAnalyticsWrapperDto } from './dto/customer-analytics.dto';
import {
  AdminCustomerDetailWrapperDto,
  AdminCustomerTransactionsWrapperDto,
} from './dto/admin-customer-detail.dto';
import { AdminCustomerMeasurementsWrapperDto } from './dto/admin-customer-measurements.dto';
import { AdminCustomerReviewsWrapperDto } from './dto/admin-customer-reviews.dto';
import { AdminProfileOverviewWrapperDto } from './dto/admin-profile.dto';
import { AdminUpdateBusinessDto } from './dto/admin-update-business.dto';
import {
  CreateVendorNoteDto,
  EscalateVendorDto,
} from '../business/dto/vendor-note.dto';
import { VendorNotesService } from '../business/vendor-notes.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserService } from '../ums/services';
import { TicketService } from '../ticket/ticket.service';
import { BusinessService } from '../business/business.service';
import { OrderService } from '../orders/orders.service';
import { FetchCustomersDto } from '../ums/dto/fetch-customer.dto';
import { UpdateCustomerStatusDto } from '../ums/dto/customer-status.dto';
import { UserType } from '../ums/schemas';
import { AssignTicketDto, TicketFilterDto } from '../ticket/dto/ticket.dto';
import {
  CreateTicketReplyDto,
  TicketReplyResponseDto,
} from '../ticket/dto/ticket-reply.dto';
import { PlatformService } from './platform.service';
import { TransactionService } from '../transactions/transactions.service';
import { UpdatePlatformSettingsDto } from './dto/update-settings.dto';

@ApiTags('Admin')
@Controller('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class PlatformController {
  constructor(
    private readonly userService: UserService,
    private readonly ticketService: TicketService,
    private readonly businessService: BusinessService,
    private readonly orderService: OrderService,
    private readonly platformService: PlatformService,
    private readonly transactionService: TransactionService,
    private readonly vendorNotesService: VendorNotesService,
  ) {}

  // ------------------------------------------------------
  // GET ALL BUSINESSES
  // ------------------------------------------------------
  @Get('businesses')
  @ApiOperation({ summary: 'Get all registered businesses' })
  @ApiResponse({
    status: 200,
    description: 'List of businesses retrieved successfully',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number',
    type: Number,
  })
  @ApiQuery({
    name: 'size',
    required: false,
    description: 'Number of items per page',
    type: Number,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      "Filter by the console's status buckets — 'active', 'inactive' or 'pending' (Awaiting verification) — or by a raw BusinessStatus such as 'verified'. Omit for all. The `summary` counts are always whole-collection and ignore this.",
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      "Case-insensitive match across the business name and email and the owning vendor's name and email — the identity fields the vendors table displays.",
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['revenue', 'products', 'orders', 'date', 'name'],
    description:
      "Column to sort by. Defaults to 'date' (oldest first), which is the order this endpoint returned before sorting was supported.",
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ['asc', 'desc'],
    description: "Sort direction. Defaults to 'asc'.",
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description:
      'Only vendors onboarded on or after this ISO date. Matched on createdAt — the table\'s "Date onboarded" column.',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Only vendors onboarded on or before this ISO date.',
  })
  async getAllBusinesses(
    @Query('page') page: number,
    @Query('size') size: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.businessService.findAllBusinesses(
      page,
      size,
      status,
      search,
      sort,
      order,
      startDate,
      endDate,
    );
  }
  // ------------------------------------------------------
  // PER-VENDOR CHARTS + LEDGER (admin-scoped)
  // ------------------------------------------------------
  //
  // Declared before 'businesses/:id' so neither is shadowed by it.
  @Patch('businesses/:id')
  @ApiOperation({
    summary: 'Update a vendor’s profile (admin)',
    description:
      "Edits another business's own details — name, contact, address, imagery and payout account. PATCH /business/profile only ever updates the CALLER's business, so an admin had no way to correct a vendor's record. The body is an allowlist: status has its own approve/verify/reject routes, and earnings, payout history and the transfer recipient code are never writable here.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({ status: 404, description: 'Business not found' })
  // The allowlist above is only real with `whitelist`. The global pipe sets
  // `transform` but not `whitelist`, so unknown keys survive validation — and
  // `updateBusinessProfile` `$set`s the body wholesale, which meant a request
  // carrying `status`, `earnings` or `transfer_recipient_code` wrote them
  // straight to the record. Stripping happens here rather than globally so no
  // other endpoint's payload changes shape.
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateBusiness(
    @Param('id') id: string,
    @Body() dto: AdminUpdateBusinessDto,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid business id');
    }
    return this.businessService.updateBusinessProfile(id, dto);
  }

  @Get('businesses/:id/warehouses')
  @ApiOperation({
    summary: 'List a vendor’s warehouses (admin)',
    description:
      "GET /business/warehouse is scoped to the caller's own business, so the console could only ever show a warehouse COUNT with nothing behind it. This takes the id in the path.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async getBusinessWarehouses(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('size') size = 10,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid business id');
    }
    return this.businessService.findAllWarehouse(id, {
      page: Number(page),
      size: Number(size),
    });
  }

  // ------------------------------------------------------
  // VENDOR NOTES, FLAGS AND ESCALATION (admin)
  // ------------------------------------------------------
  @Get('businesses/:id/notes')
  @ApiOperation({
    summary: 'List a vendor’s internal notes and flags',
    description:
      "The admin console's own record of a vendor. Never shown to the vendor. Notes and flags share one collection: a flag without a reason is useless, and a reason is a note.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 20 })
  async getVendorNotes(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    return this.vendorNotesService.list(id, Number(page), Number(size));
  }

  @Post('businesses/:id/notes')
  @ApiOperation({
    summary: 'Add a note, or flag the vendor',
    description:
      "kind 'flag' raises a concern and marks the vendor flagged in the vendors list; kind 'note' (the default) is an ordinary remark.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async addVendorNote(
    @Param('id') id: string,
    @Body() dto: CreateVendorNoteDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.vendorNotesService.create(id, req.user?.id ?? '', dto);
  }

  @Patch('vendor-notes/:noteId/resolve')
  @ApiOperation({
    summary: 'Clear a flag',
    description:
      'Only a flag can be resolved — a "resolved" note would just be a hidden one. The vendor stays flagged while any other flag is still open.',
  })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  async resolveVendorNote(
    @Param('noteId') noteId: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.vendorNotesService.resolve(noteId, req.user?.id ?? '');
  }

  @Delete('vendor-notes/:noteId')
  @ApiOperation({ summary: 'Delete a note or flag' })
  @ApiParam({ name: 'noteId', description: 'Note ID', type: String })
  async deleteVendorNote(@Param('noteId') noteId: string) {
    return this.vendorNotesService.remove(noteId);
  }

  @Post('businesses/:id/escalate')
  @ApiOperation({
    summary: 'Escalate a vendor to support',
    description:
      "Raises a support ticket against the vendor. This is not a new concept: tickets already carry a business, a status and an assignee, and the console already has a queue and a detail screen for them — so escalation creates one rather than inventing a parallel record.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  async escalateVendor(
    @Param('id') id: string,
    @Body() dto: EscalateVendorDto,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid business id');
    }
    return this.ticketService.create(id, {
      issue_type: dto.issue_type,
      description: dto.description,
    });
  }

  @Get('businesses/:id/chart')
  @ApiOperation({
    summary: 'Get one vendor’s charts (admin)',
    description:
      "The same bundle a vendor sees at GET /orders/chart — summary plus charts by audience, location, product, product kind and day of week — but scoped to the business in the path rather than to the caller's own token, so an admin can read any vendor's.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  async getBusinessChartForAdmin(@Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid business id');
    }
    return this.orderService.getBusinessChart(id);
  }

  @Get('businesses/:id/transactions')
  @ApiOperation({
    summary: 'Get one vendor’s transactions (admin)',
    description:
      "Wallet ledger for the business in the path — the admin console's vendor Activity Log. GET /transactions/vendor cannot serve this: it derives the business from the caller's own token, so an admin calling it dereferences an absent business.",
  })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    description: "Optional transaction status filter; 'all' for every status.",
  })
  async getBusinessTransactions(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid business id');
    }
    return this.transactionService.findByBusiness(
      new Types.ObjectId(id),
      Number(page),
      Number(size),
      status,
    );
  }

  @Get('businesses/:id')
  @ApiOperation({ summary: 'Get a single business by ID' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  getBusinessById(@Param('id') id: string) {
    return this.businessService.findBusinessById(id);
  }

  // ------------------------------------------------------
  // APPROVE BUSINESS
  // ------------------------------------------------------
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a business' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business approved successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  approve(@Param('id') id: string) {
    return this.businessService.approveBusiness(id);
  }

  // ------------------------------------------------------
  // VERIFY BUSINESS
  // ------------------------------------------------------
  @Post(':id/verify')
  @ApiOperation({ summary: 'Verify a business (final verification step)' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business verified successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  verify(@Param('id') id: string) {
    return this.businessService.verifyBusiness(id);
  }

  // ------------------------------------------------------
  // REJECT BUSINESS
  // ------------------------------------------------------
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a business' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business rejected successfully',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  reject(@Param('id') id: string) {
    return this.businessService.rejectBusiness(id);
  }

  // ------------------------------------------------------
  // SET BUSINESS BACK TO IN-REVIEW
  // ------------------------------------------------------
  @Post(':id/in-review')
  @ApiOperation({ summary: 'Set a business to in-review' })
  @ApiParam({ name: 'id', description: 'Business ID', type: String })
  @ApiResponse({
    status: 200,
    description: 'Business moved to in-review status',
  })
  @ApiResponse({ status: 404, description: 'Business not found' })
  setInReview(@Param('id') id: string) {
    return this.businessService.setInReview(id);
  }
  /** ---------------- Admin Profile Drawer ---------------- */
  //
  // Declared before the ':id' routes below so 'me' is never taken for an id.
  @Get('me/overview')
  @ApiOperation({
    summary: 'Get the signed-in admin’s profile overview',
    description:
      'Backs the admin console\'s profile drawer: marketplace counters this admin oversees, their own ticket workload, and their assigned tickets from the last 30 days. A "task" is an assigned support ticket — this backend has no separate task or audit-log collection.',
  })
  @ApiOkResponse({ type: AdminProfileOverviewWrapperDto })
  async getAdminProfileOverview(@Req() req: { user?: { id?: string } }) {
    return this.orderService.getAdminProfileOverview(req.user?.id ?? '');
  }

  /** ---------------- Admin Dashboard ---------------- */
  @Get('dashboard')
  @ApiOperation({
    summary: 'Get admin dashboard metrics',
    description:
      'Platform-wide overview counters for the admin console. Takes no request payload and no query parameters: every figure is all-time and cannot be narrowed to a period.',
  })
  @ApiOkResponse({ type: AdminDashboardMetricsWrapperDto })
  async getAdminDashboard() {
    return this.orderService.getAdminDashboardMetrics();
  }

  /** ---------------- Admin Dashboard Charts ---------------- */
  //
  // Sibling of GET /admin/dashboard rather than part of it: the counters above
  // are three countDocuments calls, while these are seven aggregations over the
  // whole orders collection. Folding them together would make every card on the
  // page wait for the slowest chart.
  @Get('dashboard/charts')
  @ApiOperation({
    summary: 'Get admin dashboard chart series',
    description:
      'Platform-wide chart data for the admin console, in the same `{ chartType, title, series }` envelope the vendor dashboard uses at GET /orders/chart. The time series (revenueByMonth, orderCountByMonth) are scoped to `year`; the distribution charts are all-time, matching the counters on GET /admin/dashboard.',
  })
  @ApiQuery({
    name: 'year',
    type: Number,
    required: false,
    description:
      'Calendar year for the monthly series. Defaults to the year of the most recent order — not the current year, so a database whose newest order is older still renders a populated chart.',
  })
  @ApiOkResponse({ type: AdminDashboardChartsWrapperDto })
  async getAdminDashboardCharts(@Query('year') year?: string) {
    // ValidationPipe({ transform: true }) only coerces DTO-typed bodies and
    // params, not a bare @Query scalar, so `year` arrives as a string. An
    // unparseable or out-of-range value falls back to the default rather than
    // producing a NaN date range that matches nothing.
    const parsed = Number(year);
    const resolved =
      year !== undefined &&
      Number.isInteger(parsed) &&
      parsed >= 2000 &&
      parsed <= 2100
        ? parsed
        : undefined;

    return this.orderService.getAdminChart(resolved);
  }

  /** ---------------- Vendor Dashboard ---------------- */
  @Get('vendor/dashboard')
  @ApiOperation({ summary: 'Get vendor/business dashboard metrics' })
  @ApiQuery({ name: 'businessId', type: String, required: true })
  async getVendorDashboard(@Query('businessId') businessId: string) {
    return this.orderService.getVendorDashboardMetrics(
      new Types.ObjectId(businessId),
    );
  }

  @Get('vendor/orders')
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Optional order status filter',
  })
  @ApiQuery({
    name: 'customerId',
    required: false,
    description:
      "Optional filter to one buyer's orders — backs the admin customer detail page, which needs the same order shape this endpoint already returns.",
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      "Optional filter to one vendor's orders. The service has always supported this filter; it simply was not reachable from this route, so the console's vendor page could only link to the platform-wide list.",
  })
  async findVendorOrders(
    @Query('page')
    page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('businessId') businessId?: string,
  ) {
    // An unparseable id would throw inside the aggregation; treat it as no
    // filter rather than a 500.
    const customer =
      customerId && Types.ObjectId.isValid(customerId)
        ? new Types.ObjectId(customerId)
        : undefined;

    const business =
      businessId && Types.ObjectId.isValid(businessId)
        ? new Types.ObjectId(businessId)
        : undefined;

    return this.orderService.findVendorOrders(
      Number(page),
      Number(size),
      status,
      business,
      customer,
    );
  }

  @Get('customer')
  @ApiOperation({ summary: 'Fetch customers with filters' })
  async fetchCustomers(@Query() filters: FetchCustomersDto) {
    return this.userService.fetchCustomers(filters.page, filters.size, filters);
  }

  // ------------------------------------------------------
  // CUSTOMER DETAIL (admin)
  // ------------------------------------------------------
  @Get('customer/:id')
  @ApiOperation({
    summary: 'Get one customer with their full profile and account totals',
    description:
      "Everything the console's customer detail header shows, in one call: profile fields, the default address (plus a ready-made `location` string), last sign-in, order counts and lifetime spend, wallet and token balances, followed vendors, reserved fabrics and authored reviews.\n\nsnake_case keys, like every other endpoint here. Counts and money are numbers including 0 — a customer with no orders has zero orders, which is a fact; a null there would render as a dash and claim the figure is unknown. Only a genuinely absent value is null.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiOkResponse({ type: AdminCustomerDetailWrapperDto })
  @ApiResponse({
    status: 404,
    description: 'No customer with that id, or the id is not an ObjectId',
  })
  async getCustomerDetail(@Param('id') id: string) {
    return this.userService.getCustomerDetail(id);
  }

  @Get('customer/:id/transactions')
  @ApiOperation({
    summary: "Get one customer's transactions (admin)",
    description:
      "The admin-scoped twin of GET /transactions/customer, which reads the CALLER's id from the token — so an admin hitting it got their own (empty) ledger instead of the customer's. This one takes the customer from the path.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Optional transaction status filter',
  })
  @ApiOkResponse({ type: AdminCustomerTransactionsWrapperDto })
  @ApiResponse({ status: 404, description: 'The id is not an ObjectId' })
  async getCustomerTransactions(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query('status') status?: string,
  ) {
    // Without this an unparseable id reaches the query as a cast failure and
    // surfaces as a 500 rather than the 404 it actually is.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Customer not found');
    }

    return this.transactionService.findByCustomer(
      id,
      Number(page),
      Number(size),
      status,
    );
  }

  @Get('customer/:id/reviews')
  @ApiOperation({
    summary: "Get the reviews one customer wrote (admin)",
    description:
      "What the `reviews_count` on their detail header counts. Ratings are embedded in `products.ratings[]`, one entry per product per user, so there is no reviews collection to page — the pipeline unwinds the array and keeps only this customer's entries, joining the product's name, first image and selling vendor onto each.\n\nThe summary is over their whole history rather than the page: the star distribution describes the customer, and would otherwise move as the reader pages through.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 20 })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['recent', 'highest', 'lowest'],
    description:
      "Defaults to 'recent'. Ratings carry no timestamp, so recency is the generation time of the rating's ObjectId — when it was pushed.",
  })
  @ApiOkResponse({ type: AdminCustomerReviewsWrapperDto })
  @ApiResponse({
    status: 404,
    description: 'The id is not an ObjectId',
  })
  async getCustomerReviews(
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
    @Query('sortBy') sortBy?: 'recent' | 'highest' | 'lowest',
  ) {
    return this.userService.getCustomerReviews(
      id,
      Number(page),
      Number(size),
      sortBy,
    );
  }

  // Platform staff only, like the order-scoped twin below: body
  // measurements are the most personal record this backend holds, and the
  // rest of the customer routes here are gated by the console's own login
  // rather than by a role on the handler.
  @Roles(UserType.PLATFORM)
  @Get('customer/:id/measurements')
  @ApiOperation({
    summary: "Get one customer's body measurements and body type (admin)",
    description:
      "The console's Body Measurement panel. Every route under /measurements is customer-scoped and reads the caller's id from the token, so an admin hitting them got their own (empty) sets; this one takes the customer from the path.\n\nReturns every saved set (active first) with its unit and its flat { key: number } map — only the keys the customer actually recorded — plus the body-type classification. Read-only: where GET /measurements/body-type caches a fresh classification onto the user, this one computes an uncached result in memory and returns it with `computed_at: null` rather than writing to the record an admin is merely looking at.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiOkResponse({ type: AdminCustomerMeasurementsWrapperDto })
  @ApiResponse({
    status: 404,
    description: 'No customer with that id, or the id is not an ObjectId',
  })
  async getCustomerMeasurements(@Param('id') id: string) {
    return this.userService.getCustomerMeasurements(id);
  }

  // ------------------------------------------------------
  // CUSTOMER ACCOUNT STATE (admin)
  // ------------------------------------------------------
  @Patch('customer/:id/status')
  @ApiOperation({
    summary: "Set a customer's account state",
    description:
      "Sign-in matches on status 'active', so this is what actually locks a customer out. Both 'inactive' and 'suspended' block access; the difference is intent — dormant versus acted-against. Scoped to customers: the users collection also holds vendors and platform staff.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiOkResponse({ description: 'The updated customer' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async setCustomerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerStatusDto,
  ) {
    return this.userService.setCustomerStatus(id, dto.status);
  }

  @Delete('customer/:id')
  @ApiOperation({
    summary: 'Permanently delete a customer',
    description:
      "Refuses with a 409 when the customer has orders: their buyer reference would dangle and every past order would render unattributable. Suspend instead. This exists for spam and test accounts that never transacted.",
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({
    status: 409,
    description: 'The customer has orders and cannot be deleted',
  })
  async deleteCustomer(@Param('id') id: string) {
    return this.userService.deleteCustomer(id);
  }

  /** ---------------- Customer Analytics ---------------- */
  @Get('customer/:id/analytics')
  @ApiOperation({
    summary: 'Get analytics for one customer',
    description:
      'Order history, spend and on-platform activity for a single customer, in the same `{ chartType, title, series }` envelope as GET /admin/dashboard/charts. The summary is all-time; only `spendByMonth` is scoped to `year`.',
  })
  @ApiParam({ name: 'id', description: 'Customer (User) id', type: String })
  @ApiQuery({
    name: 'year',
    type: Number,
    required: false,
    description:
      "Calendar year for the spend series. Defaults to the year of this customer's most recent order.",
  })
  @ApiOkResponse({ type: CustomerAnalyticsWrapperDto })
  async getCustomerAnalytics(
    @Param('id') id: string,
    @Query('year') year?: string,
  ) {
    const parsed = Number(year);
    const resolved =
      year !== undefined &&
      Number.isInteger(parsed) &&
      parsed >= 2000 &&
      parsed <= 2100
        ? parsed
        : undefined;

    return this.orderService.getCustomerAnalytics(id, resolved);
  }

  @Roles(UserType.PLATFORM)
  @Get('orders/:reference/measurements')
  @ApiOperation({
    summary: "Read an order customer's measurement set (admin, read-only)",
  })
  @ApiParam({ name: 'reference', description: 'Order reference' })
  async getOrderMeasurements(@Param('reference') reference: string) {
    return this.orderService.getOrderCustomerMeasurements(reference);
  }

  @Roles(UserType.PLATFORM)
  @Get('orders/:reference/production')
  @ApiOperation({ summary: 'Get an order production checklist (admin, read-only)' })
  @ApiParam({ name: 'reference', description: 'Order reference' })
  async getOrderProduction(@Param('reference') reference: string) {
    return this.orderService.getOrderProduction(reference);
  }

  @Roles(UserType.PLATFORM)
  @Get('tickets')
  @ApiOperation({ summary: 'Get paginated tickets with filters' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  async findAll(
    @Query() filters: TicketFilterDto,
    @Query('page') page: number = 1,
    @Query('size') size: number = 10,
  ) {
    return this.ticketService.findAll(filters, page, size);
  }

  @Roles(UserType.PLATFORM)
  @Get('assigned/:team_id')
  @ApiOperation({ summary: 'Get all tickets assigned to a support team' })
  async getAssignedTickets(
    @Param('team_id') team_id: Types.ObjectId,
    @Query('page') page = 1,
    @Query('size') size = 10,
    @Query() query: any,
  ) {
    return this.ticketService.findAssignedTickets(team_id, query, page, size);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign ticket to a support team' })
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.ticketService.assign(id, dto);
  }
  @Post(':ticket_id/reply')
  @ApiOperation({ summary: 'Reply to a ticket (vendor/admin/support)' })
  @ApiCreatedResponse({ type: TicketReplyResponseDto })
  async replyToTicket(
    @Param('ticket_id') ticket_id: Types.ObjectId,
    @Req() req,
    @Body() dto: CreateTicketReplyDto,
  ) {
    return this.ticketService.createReply(ticket_id, req.user.id, dto);
  }
  @Roles(UserType.PLATFORM)
  @Patch('settings')
  @ApiOperation({ summary: 'Update platform settings' })
  async updateSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.platformService.update(dto);
  }
  @Roles(UserType.PLATFORM)
  @Get('settings')
  @ApiOperation({ summary: 'Get current platform settings' })
  async getSettings() {
    return this.platformService.getSettings();
  }
  @Roles(UserType.PLATFORM)
  @ApiOperation({ summary: 'Update platform token price' })
  @Post('refresh-token-price')
  async refreshTokenPrice() {
    return this.platformService.updateNgnTokenPrice();
  }
}
