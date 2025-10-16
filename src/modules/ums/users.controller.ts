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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
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
    return this.teamService.listTeamMembers(req.business._id);
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
}
