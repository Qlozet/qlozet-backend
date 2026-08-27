import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Query,
  Delete,
  Patch,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesService, UserService } from './services';
import { InviteTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';
import { TeamService } from './services/team.service';
import { AdminsService } from './services/admins.service';
import { PermissionService } from './services/permissions.service';
import {
  CreateAdminDto,
  FetchAdminsDto,
  UpdateAdminDto,
  UpdateAdminStatusDto,
} from './dto/admin.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import {
  PlatformRole,
  Role,
  RoleType,
  VendorRole,
} from './schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { TeamMember } from './schemas/team.schema';
import {
  AssignPermissionsDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/roles.dto';
import { AddressDto, UpdateAddressDto } from './dto/address.dto';
import { UpdateUserDto } from './dto/users.dto';
import { UpdatePlatformSettingsDto } from '../platform/dto/update-settings.dto';
import { PlatformService } from '../platform/platform.service';
import { BusinessService } from '../business/business.service';
import { PaginationQueryType } from 'src/common/types/pagination.type';
import { UserType } from './schemas';

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly teamService: TeamService,
    private readonly adminsService: AdminsService,
    private readonly permissionsService: PermissionService,
    private readonly rolesService: RolesService,
    private readonly platformService: PlatformService,
    private readonly businessService: BusinessService,
  ) {}

  /**
   * The caller's business id, for the vendor-scoped routes below.
   *
   * RolesGuard only attaches `req.business` on its vendor branch — a platform
   * admin passes the guard on the admin bypass with no business at all, so
   * every one of these handlers used to read `.id` off undefined and answer a
   * 500 ("Cannot read properties of undefined"). Platform staff belong on
   * /users/admins; say so instead.
   */
  private businessIdOf(req: any): string {
    const businessId = req?.business?.id;
    if (!businessId) {
      throw new ForbiddenException(
        'This route manages a vendor business team. Platform administrators are managed at /users/admins.',
      );
    }
    return businessId;
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('team/invite-member')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Invite a new team member',
    description:
      'Invites a new member to join the business. Sends an email with an invite link.',
  })
  @ApiBody({
    type: InviteTeamMemberDto,
    description: 'Data required to invite a team member',
  })
  @ApiResponse({
    status: 201,
    description: 'Team member invitation created successfully.',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or missing data.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. User must be logged in.',
  })
  async inviteTeamMember(
    @Body() inviteTeamMemberDto: InviteTeamMemberDto,
    @Req() req: any,
  ) {
    const inviter = req.user;
    // Called for the guard, not the value: the service takes the business
    // document, and without this a caller who has none reaches it as undefined.
    this.businessIdOf(req);

    return this.teamService.inviteTeamMember(
      inviteTeamMemberDto,
      inviter,
      req.business,
    );
  }
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Get('team/members')
  @ApiOperation({ summary: 'Get all team members' })
  async getTeamMembers(@Req() req: any): Promise<TeamMember[]> {
    return this.teamService.listTeamMembers(this.businessIdOf(req));
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Patch('team/members/:id')
  @ApiOperation({ summary: 'Update a team member (name, phone, role, active)' })
  @ApiParam({ name: 'id', description: 'Team member ID' })
  @ApiBody({ type: UpdateTeamMemberDto })
  async updateTeamMember(
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
    @Req() req: any,
  ) {
    return this.teamService.updateMember(id, this.businessIdOf(req), dto);
  }

  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Delete('team/members/:id')
  @ApiOperation({ summary: 'Remove a team member' })
  @ApiParam({ name: 'id', description: 'Team member ID' })
  async removeTeamMember(@Param('id') id: string, @Req() req: any) {
    return this.teamService.removeMember(id, this.businessIdOf(req));
  }

  // ==============================
  // PLATFORM ADMINISTRATORS
  // ==============================
  //
  // The console's Admin Management screen. Kept apart from the team routes
  // above on purpose: those manage a VENDOR's staff, scoped to a business,
  // while these manage Qlozet's own — Users with `type: platform` and a
  // platform role, which is what `loginPlatform` authenticates.

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Get('admins')
  @ApiOperation({
    summary: 'List platform administrators',
    description:
      'The Administrators table. Paginated, newest first, with optional search over name, email and phone, and filters by role (id or name) and account status.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false, example: 'shola' })
  @ApiQuery({ name: 'role', required: false, example: 'operations' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive', 'suspended'],
  })
  async listAdmins(@Query() filters: FetchAdminsDto) {
    return this.adminsService.list(filters);
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Get('admins/:id')
  @ApiOperation({ summary: 'Get one platform administrator' })
  @ApiParam({ name: 'id', description: 'Admin (User) id' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async getAdmin(@Param('id') id: string) {
    return this.adminsService.findOne(id);
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a platform administrator',
    description:
      'Creates the account outright — there is no accept-invite step for platform staff — and emails them a temporary password to sign in with. The role must be a platform role; a vendor role is rejected.',
  })
  @ApiBody({ type: CreateAdminDto })
  @ApiResponse({ status: 201, description: 'Admin created' })
  @ApiResponse({ status: 400, description: 'Unknown role, or a vendor role' })
  @ApiResponse({
    status: 409,
    description: 'That email or phone number is already in use',
  })
  async createAdmin(@Body() dto: CreateAdminDto, @Req() req: any) {
    return this.adminsService.create(dto, req.user);
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Patch('admins/:id')
  @ApiOperation({
    summary: 'Edit a platform administrator',
    description:
      "Name, phone, role and account status. Email is the sign-in identity and is not editable here. Refuses any change that would leave no active super admin, and refuses to change your OWN status — locking yourself out of the console is never the intent.",
  })
  @ApiParam({ name: 'id', description: 'Admin (User) id' })
  @ApiBody({ type: UpdateAdminDto })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  async updateAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateAdminDto,
    @Req() req: any,
  ) {
    return this.adminsService.update(id, dto, req.user?.id);
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Patch('admins/:id/status')
  @ApiOperation({
    summary: "Activate or deactivate an administrator",
    description:
      "Platform sign-in requires status 'active', so this is what actually admits or locks out an admin.",
  })
  @ApiParam({ name: 'id', description: 'Admin (User) id' })
  @ApiBody({ type: UpdateAdminStatusDto })
  async setAdminStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAdminStatusDto,
    @Req() req: any,
  ) {
    return this.adminsService.setStatus(id, dto.status, req.user?.id);
  }

  @Roles(PlatformRole.SUPER_ADMIN)
  @Delete('admins/:id')
  @ApiOperation({
    summary: 'Permanently delete an administrator',
    description:
      'Super admins only — deactivating is the reversible option and should be the default. Refuses to delete you, or the last active super admin.',
  })
  @ApiParam({ name: 'id', description: 'Admin (User) id' })
  async deleteAdmin(@Param('id') id: string, @Req() req: any) {
    return this.adminsService.remove(id, req.user?.id);
  }

  // ==============================
  // ROLES MANAGEMENT
  // ==============================

  @Roles(UserType.VENDOR)
  @Get('roles/vendor')
  @ApiOperation({ summary: 'Get all vendor roles' })
  async getVendorRoles(): Promise<Role[]> {
    return this.rolesService.getVendorRoles();
  }

  @Roles(
    UserType.VENDOR,
    PlatformRole.ADMIN,
    PlatformRole.SUPER_ADMIN,
    PlatformRole.SALES,
  )
  @Get('roles')
  @ApiOperation({
    summary: 'Get all roles (platform + vendor)',
    description:
      "Pass ?type=platform for the console's own roles, or ?type=vendor for the ones a business grants its team. Unfiltered returns both, which is rarely what a screen wants — a role picker showing vendor roles to an admin will offer roles their user type can never hold.",
  })
  @ApiQuery({ name: 'type', required: false, enum: ['platform', 'vendor'] })
  async getAllRoles(@Query('type') type?: string): Promise<Role[]> {
    const filter =
      type === 'platform'
        ? RoleType.PLATFORM
        : type === 'vendor'
          ? RoleType.VENDOR
          : undefined;
    return this.rolesService.findAll(filter);
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Get('permissions')
  @ApiOperation({
    summary: "The console's permission grid",
    description:
      "Every module x action cell the Edit Access screen renders, with the permission id behind it — the ids to send back in PUT /users/roles/:id/permissions. Cells missing from the catalogue are created on first read, so the grid is never empty.",
  })
  async getConsolePermissions() {
    return this.permissionsService.getConsoleCatalogue();
  }

  @Roles(PlatformRole.SUPER_ADMIN, PlatformRole.ADMIN)
  @Post('roles/defaults')
  @ApiOperation({
    summary: 'Create the default platform roles',
    description:
      "Idempotent. Creates any of the console's standard platform roles (super admin, admin, customer support, operations, marketing, data analyst, sales) that do not exist yet, each with a sensible starting grant. Never touches a role that already exists.",
  })
  async createDefaultRoles() {
    return this.rolesService.ensurePlatformDefaults();
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @Get('roles/:id')
  @ApiOperation({ summary: 'Get role by ID' })
  async getRoleById(@Param('id') id: string): Promise<Role> {
    return this.rolesService.findById(id);
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Post('roles')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  @ApiResponse({ status: 409, description: 'A role of that name already exists' })
  async createRole(@Body() dto: CreateRoleDto): Promise<Role> {
    return this.rolesService.createFromDto(dto);
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Patch('roles/:id')
  @ApiOperation({ summary: 'Update an existing role' })
  @ApiBody({ type: UpdateRoleDto })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<Role> {
    return this.rolesService.updateFromDto(id, dto);
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Delete('roles/:id')
  @ApiOperation({
    summary: 'Delete a role by ID',
    description:
      'Refuses with a 409 while anyone still holds the role, or when it is a built-in one.',
  })
  async deleteRole(@Param('id') id: string): Promise<{ message: string }> {
    await this.rolesService.deleteRole(id);
    return { message: 'Role deleted successfully' };
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Put('roles/:id/permissions')
  @ApiOperation({
    summary: "Replace a role's permissions",
    description:
      "Sets the role's grant to exactly these permission ids. The Edit Access grid is a complete picture of what a role may do, so saving it has to clear what was unticked — which assign/remove, being additive and subtractive halves, cannot do in one call.",
  })
  @ApiBody({ type: AssignPermissionsDto })
  async setRolePermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ): Promise<Role> {
    return this.rolesService.setPermissions(id, dto.permission_ids);
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Post('roles/:id/assign-permissions')
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiBody({ type: AssignPermissionsDto })
  async assignPermissionsToRole(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ): Promise<Role> {
    return this.rolesService.assignPermissionsToRole(id, dto.permission_ids);
  }

  @Roles(UserType.VENDOR, PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN)
  @VendorRoles(VendorRole.OWNER)
  @Post('roles/:id/remove-permissions')
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiBody({ type: AssignPermissionsDto })
  async removePermissionsFromRole(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ): Promise<Role> {
    return this.rolesService.removePermissionsFromRole(id, dto.permission_ids);
  }

  // ==============================
  // ADDRESS BOOK
  // ==============================

  @Roles(UserType.CUSTOMER)
  @Post('customer/addresses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new address to address book' })
  @ApiBody({ type: AddressDto })
  @ApiResponse({ status: 201, description: 'Address created' })
  async addAddress(@Req() req, @Body() dto: AddressDto) {
    const address = await this.userService.addAddress(req.user, dto);
    return { message: 'Address added successfully', data: address };
  }

  @Roles(UserType.CUSTOMER)
  @Get('customer/addresses')
  @ApiOperation({ summary: 'List all saved addresses' })
  @ApiResponse({ status: 200, description: 'Address list (default first)' })
  async listAddresses(@Req() req) {
    const addresses = await this.userService.listAddresses(req.user.id);
    return addresses;
  }

  @Roles(UserType.CUSTOMER)
  @Get('customer/addresses/default')
  @ApiOperation({ summary: 'Get default address' })
  @ApiResponse({ status: 200, description: 'Default address' })
  async getDefaultAddress(@Req() req) {
    const address = await this.userService.getDefaultAddress(req.user.id);
    if (!address) {
      return { message: 'No address found', data: null };
    }
    return address;
  }

  @Roles(UserType.CUSTOMER)
  @Get('customer/addresses/:id')
  @ApiOperation({ summary: 'Get a specific address by ID' })
  async getAddressById(@Req() req, @Param('id') id: string) {
    const address = await this.userService.getAddressById(req.user.id, id);
    return address;
  }

  @Roles(UserType.CUSTOMER)
  @Patch('customer/addresses/:id')
  @ApiOperation({ summary: 'Update an existing address' })
  @ApiBody({ type: UpdateAddressDto })
  async updateAddress(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const address = await this.userService.updateAddress(req.user.id, id, dto);
    return { message: 'Address updated successfully', data: address };
  }

  @Roles(UserType.CUSTOMER)
  @Delete('customer/addresses/:id')
  @ApiOperation({ summary: 'Delete an address' })
  async deleteAddress(@Req() req, @Param('id') id: string) {
    return this.userService.deleteAddress(req.user.id, id);
  }

  @Roles(UserType.CUSTOMER)
  @Patch('customer/addresses/:id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set an address as default' })
  async setDefaultAddress(@Req() req, @Param('id') id: string) {
    const address = await this.userService.setDefaultAddress(req.user.id, id);
    return { message: 'Default address updated', data: address };
  }

  // ── Deprecated routes (backward compat) ──

  /** @deprecated Use POST /customer/addresses instead */
  @Roles(UserType.CUSTOMER)
  @Post('customer/shipping-address/upsert')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[DEPRECATED] Upsert single address', deprecated: true })
  async upsertAddress(@Req() req, @Body() dto: AddressDto) {
    const address = await this.userService.upsertUserAddress(req.user, dto);
    return { message: 'Address saved successfully', data: address };
  }

  /** @deprecated Use GET /customer/addresses/default instead */
  @Roles(UserType.CUSTOMER)
  @Get('customer/shipping-address')
  @ApiOperation({ summary: '[DEPRECATED] Get single address', deprecated: true })
  async getMyAddress(@Req() req) {
    const address = await this.userService.getUserAddress(req.user.id);
    return address;
  }

  // ==============================
  // USER PROFILE
  // ==============================

  @Get('me')
  async getMyProfile(@Req() req) {
    const userId = req.user.id;
    return this.userService.getSanitizedUser(userId);
  }

  @Patch('me/profile')
  async updateMyProfile(@Req() req, @Body() profileData: UpdateUserDto) {
    const userId = req.user.id;
    const updatedUser = await this.userService.updateProfile(
      userId,
      profileData,
    );
    return { message: 'Profile updated successfully', data: updatedUser };
  }

  @Get('platform-settings')
  @ApiOperation({ summary: 'Get current payout settings' })
  @ApiResponse({
    status: 200,
    description: 'Current payout settings retrieved successfully',
  })
  async getSettings() {
    return await this.platformService.getSettings();
  }

  @Put('platform-settings')
  @ApiOperation({ summary: 'Update payout settings' })
  @ApiResponse({
    status: 200,
    description: 'Payout settings updated successfully',
  })
  async update(@Body() dto: UpdatePlatformSettingsDto) {
    return await this.platformService.update(dto);
  }

  @Roles(UserType.CUSTOMER)
  @Get('me/following-businesses')
  async getFollowing(@Req() req, @Query() dto: PaginationQueryType) {
    return this.businessService.getUserFollowingBusinesses(req.user.id, dto);
  }
  @Roles(UserType.CUSTOMER)
  @Post(':business_id/follow')
  async follow(@Param('business_id') businessId: string, @Req() req) {
    return this.businessService.followBusiness(req.user.id, businessId);
  }

  @Roles(UserType.CUSTOMER)
  @Delete(':business_id/unfollow')
  async unfollow(@Param('business_id') businessId: string, @Req() req) {
    return this.businessService.unfollowBusiness(req.user.id, businessId);
  }
  @Roles(UserType.CUSTOMER)
  @Get('feed')
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'size', required: false, example: 10 })
  @ApiQuery({ name: 'business_limit', required: false, example: 5 })
  @ApiOkResponse({
    description: 'Home feed with random businesses and latest products',
    schema: {
      example: {
        businesses: [
          {
            _id: '675ab92d9f1c2a0012cd421f',
            business_name: 'African Fashion Hub',
            business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
            description: 'Leading African fashion store.',
            city: 'Lagos',
            country: 'Nigeria',
            total_items_sold: 120,
            cumulative_rating: 4.5,
            total_number_of_ratings: 25,
            total_products: 12,
          },
          {
            _id: '675ab93f9f1c2a0012cd4220',
            business_name: 'Elegant Styles',
            business_logo_url: 'https://res.cloudinary.com/qlozet/logo2.png',
            description: 'Modern elegant clothing and accessories.',
            city: 'Abuja',
            country: 'Nigeria',
            total_items_sold: 95,
            cumulative_rating: 4.8,
            total_number_of_ratings: 15,
            total_products: 8,
          },
        ],
        latest_products: {
          total_items: 4,
          data: [
            {
              id: '690f83584d38e9188cc62f36',
              kind: 'accessory',
              base_price: 200000,
              average_rating: 0,
              business: {
                _id: '675ab92d9f1c2a0012cd421f',
                business_name: 'African Fashion Hub',
                business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
              },
            },
          ],
          total_pages: 1,
          current_page: 1,
          has_next_page: false,
          has_previous_page: false,
          page_size: 10,
        },
      },
    },
  })
  async getFeed(
    @Query('page') page: string,
    @Query('size') size: string,
    @Query('business_limit') business_limit: string,
    @Req() req,
  ) {
    return this.businessService.getFeed(
      req.user?.id,
      Number(page),
      Number(size),
      Number(business_limit),
    );
  }

  @Roles(UserType.CUSTOMER)
  @Get('vendors/top-week')
  @ApiOkResponse({
    description: 'Top vendors of the week sorted by total_items_sold',
    schema: {
      example: [
        {
          _id: '675ab92d9f1c2a0012cd421f',
          business_name: 'African Fashion Hub',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
          total_items_sold: 120,
          earnings: 5000000,
          success_rate: 98,
          is_active: true,
          status: 'approved',
          createdAt: '2025-12-01T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
        {
          _id: '675ab93f9f1c2a0012cd4220',
          business_name: 'Elegant Styles',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo2.png',
          total_items_sold: 95,
          earnings: 3200000,
          success_rate: 95,
          is_active: true,
          status: 'verified',
          createdAt: '2025-12-02T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
      ],
    },
  })
  async topVendors(@Req() req: any) {
    return this.businessService.getTopVendorsOfWeek(req.user?.id);
  }
  @Roles(UserType.CUSTOMER)
  @Get('vendors/new-week')
  @ApiOkResponse({
    description: 'Top vendors of the week sorted by total_items_sold',
    schema: {
      example: [
        {
          _id: '675ab92d9f1c2a0012cd421f',
          business_name: 'African Fashion Hub',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
          total_items_sold: 120,
          earnings: 5000000,
          success_rate: 98,
          is_active: true,
          status: 'approved',
          createdAt: '2025-12-01T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
        {
          _id: '675ab93f9f1c2a0012cd4220',
          business_name: 'Elegant Styles',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo2.png',
          total_items_sold: 95,
          earnings: 3200000,
          success_rate: 95,
          is_active: true,
          status: 'verified',
          createdAt: '2025-12-02T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
      ],
    },
  })
  async newVendors(@Req() req: any) {
    return this.businessService.getNewVendorsOfWeek(req.user?.id);
  }
  @Roles(UserType.CUSTOMER)
  @Get('vendors')
  @ApiOkResponse({
    description: 'Get vendors. No params = random 5. With page/limit = paginated sorted list.',
    schema: {
      example: [
        {
          _id: '675ab92d9f1c2a0012cd421f',
          business_name: 'African Fashion Hub',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
          total_items_sold: 120,
          earnings: 5000000,
          success_rate: 98,
          is_active: true,
          status: 'approved',
          createdAt: '2025-12-01T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
        {
          _id: '675ab93f9f1c2a0012cd4220',
          business_name: 'Elegant Styles',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo2.png',
          total_items_sold: 95,
          earnings: 3200000,
          success_rate: 95,
          is_active: true,
          status: 'verified',
          createdAt: '2025-12-02T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
      ],
    },
  })
  async fetchVendors(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (page || limit) {
      return this.businessService.getVendorsPaginated(
        req.user?.id,
        Number(page) || 1,
        Number(limit) || 20,
      );
    }
    return this.businessService.getRandomBusinesses(req.user?.id);
  }
  @Roles(UserType.CUSTOMER)
  @Get('vendors/:business_id')
  @ApiOkResponse({
    description: 'Top vendors of the week sorted by total_items_sold',
    schema: {
      example: [
        {
          _id: '675ab92d9f1c2a0012cd421f',
          business_name: 'African Fashion Hub',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo.png',
          total_items_sold: 120,
          earnings: 5000000,
          success_rate: 98,
          is_active: true,
          status: 'approved',
          createdAt: '2025-12-01T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
        {
          _id: '675ab93f9f1c2a0012cd4220',
          business_name: 'Elegant Styles',
          business_logo_url: 'https://res.cloudinary.com/qlozet/logo2.png',
          total_items_sold: 95,
          earnings: 3200000,
          success_rate: 95,
          is_active: true,
          status: 'verified',
          createdAt: '2025-12-02T12:00:00.000Z',
          updatedAt: '2025-12-08T12:00:00.000Z',
        },
      ],
    },
  })
  async fetchVendor(
    @Param('business_id') business_id: string,
    @Req() req: any,
  ) {
    return this.businessService.getSingleBusiness(req?.user?.id, business_id);
  }

  @Roles(UserType.CUSTOMER)
  @Delete('delete')
  async deleteUser(@Req() req: any) {
    return this.userService.deleteUser(req.user?.id);
  }

  @Roles(UserType.CUSTOMER)
  @Get('wishlist')
  @ApiOperation({ summary: 'Get current customer wishlist' })
  @ApiResponse({ status: 200, description: 'List of wishlist items populated with product details' })
  async getWishlist(@Req() req: any) {
    return this.userService.getWishlist(req.user.id);
  }
}
