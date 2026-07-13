// team.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { User, UserDocument, UserType } from '../schemas/user.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { TeamMember, TeamMemberDocument } from '../schemas/team.schema';
import { MailService } from '../../notifications/mail/mail.service';
import { InviteTeamMemberDto } from '../dto/team.dto';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  BusinessDocument,
  Business,
} from '../../business/schemas/business.schema';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../../notifications/schemas/notification.schema';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async inviteTeamMember(
    dto: InviteTeamMemberDto,
    inviter: UserDocument,
    business: BusinessDocument,
  ) {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const token = randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
      const tempPassword = randomBytes(6).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const role = await this.roleModel.findById(dto.role).session(session);
      if (!role) throw new BadRequestException('Role not found.');

      // ✅ Find user by email OR phone number (only check provided fields)
      const userOrConditions: Record<string, string>[] = [{ email: dto.email }];
      if (dto.phone_number) userOrConditions.push({ phone_number: dto.phone_number });

      let user = await this.userModel
        .findOne({ $or: userOrConditions })
        .session(session);

      let isNewUser = false; // 👈 track user creation

      if (!user) {
        isNewUser = true; // 👈 mark as new
        user = new this.userModel({
          full_name: dto.full_name,
          email: dto.email,
          ...(dto.phone_number && { phone_number: dto.phone_number }),
          hashed_password: hashedPassword,
          business: business.id,
          role: dto.role,
          type: UserType.VENDOR,
          email_verified: true,
          status: 'active',
          must_change_password: true,
          profile_picture: 'https://default-profile-picture.png',
        });
        await user.save({ session });
      } else {
        if (!user.business || user.business.toString() !== business.id) {
          user.business = business.id;
          await user.save({ session });
        }
      }

      // ✅ Check if user already a team member
      const existingTeamMember = await this.teamMemberModel
        .findOne({ business: business.id, user: user._id })
        .session(session);

      if (existingTeamMember) {
        throw new BadRequestException(
          `${dto.full_name} is already a member of this team.`,
        );
      }

      // ✅ Create team member record
      const teamMember = new this.teamMemberModel({
        business: business.id,
        role: dto.role,
        user: user._id,
        email: dto.email,
        full_name: dto.full_name,
        ...(dto.phone_number && { phone_number: dto.phone_number }),
        invited_by: inviter.id,
        invite_token: token,
        invite_expires: expires,
        accepted: true,
        is_owner: false,
        is_active: true,
      });
      await teamMember.save({ session });

      // ✅ Add to business
      await this.businessModel.findByIdAndUpdate(
        business.id,
        { $addToSet: { team_members: teamMember._id } },
        { session },
      );

      await session.commitTransaction();
      session.endSession();

      // ✅ Send email after transaction
      this.mailService.sendTeamInviteEmail(
        dto.email,
        dto.full_name,
        role.name,
        business.business_name,
        tempPassword,
      );

      // In-app notification to business owner
      this.notificationsService.create({
        recipient: (business as any)._id?.toString(),
        recipient_business: (business as any)._id?.toString(),
        category: NotificationCategory.TEAM,
        type: NotificationType.TEAM_MEMBER_JOINED,
        title: 'New Team Member Added',
        body: `${dto.full_name} has been invited as ${role.name}.`,
        metadata: {
          member_name: dto.full_name,
          member_email: dto.email,
          role: role.name,
        },
        action_url: '/settings',
      }).catch((err) => this.logger.warn(`Failed to create team notification: ${err.message}`));

      return {
        message: isNewUser
          ? 'New user invited successfully.'
          : 'Existing user has been added to the team successfully.',
        teamMember,
        user,
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      this.logger.error(
        `Invite team member failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async listTeamMembers(businessId: string) {
    const members = await this.teamMemberModel
      .find({ business: businessId })
      .populate('user', 'full_name email')
      .populate('role', 'name description');
    return members;
  }

  async removeMember(teamId: string) {
    const team = await this.teamMemberModel.findById(teamId);
    if (!team) throw new NotFoundException('Team member not found');

    const userId = team.user;
    const businessId = team.business;

    // Delete the team member record
    await team.deleteOne();

    // Remove from business.team_members array
    await this.businessModel.findByIdAndUpdate(businessId, {
      $pull: { team_members: team._id },
    });

    // If the user's active business was this one, switch to their next available
    if (userId) {
      const user = await this.userModel.findById(userId);
      if (user && user.business?.toString() === businessId.toString()) {
        // Find next available team membership
        const nextMembership = await this.teamMemberModel.findOne({
          user: userId,
          business: { $ne: businessId },
        });
        await this.userModel.findByIdAndUpdate(userId, {
          business: nextMembership ? nextMembership.business : null,
        });
      }
    }

    return { message: 'Team member removed successfully' };
  }
}
