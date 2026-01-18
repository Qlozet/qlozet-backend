import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesService, UserService } from './services';
import { InviteTeamMemberDto } from './dto/team.dto';
import { TeamService } from './services/team.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformRole, Role, VendorRole } from './schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { TeamMember } from './schemas/team.schema';
import {
  AssignPermissionsDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/roles.dto';
import { AddressDto } from './dto/address.dto';
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
    private readonly rolesService: RolesService,
    private readonly platformService: PlatformService,
    private readonly businessService: BusinessService,
  ) {}

  @Roles(VendorRole.OWNER)
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
    const business = req.business;
    return this.teamService.inviteTeamMember(
      inviteTeamMemberDto,
      inviter,
      business,
    );
  }
  @Roles(VendorRole.OWNER)
  @Get('team/members')
  @ApiOperation({ summary: 'Get all team members' })
  async getTeamMembers(@Req() req: any): Promise<TeamMember[]> {
    return this.teamService.listTeamMembers(req.business.id);
  }

  // ==============================
  // ROLES MANAGEMENT
  // ==============================

  @Roles(VendorRole.OWNER, VendorRole.OPERATIONS)
  @Get('roles/vendor')
  @ApiOperation({ summary: 'Get all vendor roles' })
  async getVendorRoles(): Promise<Role[]> {
    return this.rolesService.getVendorRoles();
  }

  @Roles(PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN, PlatformRole.SALES)
  @Get('roles')
  @ApiOperation({ summary: 'Get all roles (platform + vendor)' })
  async getAllRoles(): Promise<Role[]> {
    return this.rolesService.findAll();
  }

  @Roles(VendorRole.OWNER)
  @Get('roles/:id')
  @ApiOperation({ summary: 'Get role by ID' })
  async getRoleById(@Param('id') id: string): Promise<Role> {
    return this.rolesService.findById(id);
  }

  @Roles(VendorRole.OWNER)
  @Post('roles')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  async createRole(@Body() dto: CreateRoleDto): Promise<Role> {
    return this.rolesService.create(dto);
  }

  @Roles(VendorRole.OWNER)
  @Patch('roles/:id')
  @ApiOperation({ summary: 'Update an existing role' })
  @ApiBody({ type: UpdateRoleDto })
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<Role> {
    return this.rolesService.updateRole(id, dto);
  }

  @Roles(VendorRole.OWNER)
  @Delete('roles/:id')
  @ApiOperation({ summary: 'Delete a role by ID' })
  async deleteRole(@Param('id') id: string): Promise<{ message: string }> {
    await this.rolesService.deleteRole(id);
    return { message: 'Role deleted successfully' };
  }

  @Roles(VendorRole.OWNER)
  @Post('roles/:id/assign-permissions')
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiBody({ type: AssignPermissionsDto })
  async assignPermissionsToRole(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ): Promise<Role> {
    return this.rolesService.assignPermissionsToRole(id, dto.permission_ids);
  }

  @Roles(VendorRole.OWNER)
  @Post('roles/:id/remove-permissions')
  @ApiOperation({ summary: 'Remove permissions from a role' })
  @ApiBody({ type: AssignPermissionsDto })
  async removePermissionsFromRole(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
  ): Promise<Role> {
    return this.rolesService.removePermissionsFromRole(id, dto.permission_ids);
  }

  @Roles('customer')
  @Post('customer/shipping-address/upsert')
  @HttpCode(HttpStatus.OK)
  async upsertAddress(@Req() req, @Body() dto: AddressDto) {
    const user = req.user;
    const address = await this.userService.upsertUserAddress(user, dto);
    return { message: 'Address saved successfully', data: address };
  }

  @Roles('customer')
  @Get('customer/shipping-address')
  async getMyAddress(@Req() req) {
    const userId = req.user._id;
    const address = await this.userService.getUserAddress(userId);
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

  @Roles('customer')
  @Get('me/following-businesses')
  async getFollowing(@Req() req, @Query() dto: PaginationQueryType) {
    return this.businessService.getUserFollowingBusinesses(req.user.id, dto);
  }
  @Roles('customer')
  @Post(':business_id/follow')
  async follow(@Param('business_id') businessId: string, @Req() req) {
    return this.businessService.followBusiness(req.user.id, businessId);
  }

  @Roles('customer')
  @Delete(':business_id/unfollow')
  async unfollow(@Param('business_id') businessId: string, @Req() req) {
    return this.businessService.unfollowBusiness(req.user.id, businessId);
  }
  @Roles('customer')
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

  @Roles('customer')
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
  @Roles('customer')
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
  @Roles('customer')
  @Get('vendors')
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
  async fetchVendors(@Req() req: any) {
    return this.businessService.getRandomBusinesses(req.user?.id);
  }
  @Roles('customer')
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

  @Roles('customer')
  @Delete('delete')
  async deleteUser(@Req() req: any) {
    return this.userService.deleteUser(req.user?.id);
  }
}
