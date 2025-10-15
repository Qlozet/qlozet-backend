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
import { Role, VendorRole } from './schemas/role.schema';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { TeamMember } from './schemas/team.schema';

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
  @Get('roles/vendor')
  @ApiOperation({ summary: 'Get all vendor roles' })
  async getVendorRoles(): Promise<Role[]> {
    return this.rolesService.getVendorRoles();
  }
  @Roles(VendorRole.OWNER)
  @Get('team/members')
  @ApiOperation({ summary: 'Get all team members' })
  async getTeamMembers(@Req() req: any): Promise<TeamMember[]> {
    return this.teamService.listTeamMembers(req.business._id);
  }
}
