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
import { ObjectIdUtils } from '../../../common/utils/objectId.utils';
import { NotificationsService } from '../../notifications/notifications.service';
import { VendorRecipientsService } from '../../notifications/vendor-recipients.service';
import { VendorRole } from '../../ums/schemas/role.schema';
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
    private readonly vendorRecipients: VendorRecipientsService,
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
      // Only a brand-NEW user gets a temporary password; an existing Qlozet user
      // keeps their own credentials. Generated inside the new-user branch below.
      let tempPassword: string | null = null;

      const role = await this.roleModel.findById(dto.role).session(session);
      if (!role) throw new BadRequestException('Role not found.');

      // ✅ Find user by email OR phone number (only check provided fields)
      const userOrConditions: Record<string, string>[] = [{ email: dto.email }];
      if (dto.phone_number) userOrConditions.push({ phone_number: dto.phone_number });

      let user = await this.userModel
        .findOne({ $or: userOrConditions })
        .session(session);

      let isNewUser = false; // 👈 track user creation

      // A customer (or staff) account cannot double as a vendor's team member:
      // the roles guard reads the account type first, so they could never sign
      // in to the vendor app. Say so instead of silently rewiring the account.
      if (user && user.type !== UserType.VENDOR) {
        throw new BadRequestException(
          `${dto.email} belongs to a ${user.type} account. Invite a different email address.`,
        );
      }

      if (!user) {
        isNewUser = true; // 👈 mark as new
        tempPassword = randomBytes(6).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        user = new this.userModel({
          full_name: dto.full_name,
          email: dto.email,
          ...(dto.phone_number && { phone_number: dto.phone_number }),
          hashed_password: hashedPassword,
          business: ObjectIdUtils.toObjectId(business.id),
          role: dto.role,
          type: UserType.VENDOR,
          email_verified: true,
          status: 'active',
          must_change_password: true,
          profile_picture: 'https://default-profile-picture.png',
        });
        await user.save({ session });
      } else if (!user.business) {
        // Someone already on another vendor's team keeps that store open and
        // switches to this one from the store picker; only an account with no
        // store yet is pointed here.
        user.business = ObjectIdUtils.toObjectId(business.id) as Types.ObjectId;
        await user.save({ session });
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
        business: ObjectIdUtils.toObjectId(business.id),
        role: dto.role,
        user: user._id,
        email: dto.email,
        full_name: dto.full_name,
        ...(dto.phone_number && { phone_number: dto.phone_number }),
        invited_by: ObjectIdUtils.toObjectId(inviter.id),
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

      // ✅ Send email after transaction. A brand-new user gets a temporary
      // password to sign in with. An EXISTING Qlozet user was NOT given a new
      // password (resetting it would break their existing login), so they get a
      // "use your existing login" email instead — previously the temp password
      // was emailed to them too but never saved, so it never worked.
      if (isNewUser && tempPassword) {
        this.mailService
          .sendTeamInviteEmail(
            dto.email,
            dto.full_name,
            role.name,
            business.business_name,
            tempPassword,
          )
          .catch((err) =>
            this.logger.warn(`Failed to send team invite email: ${err.message}`),
          );
      } else {
        this.mailService
          .sendTeamAddedEmail(
            dto.email,
            dto.full_name,
            role.name,
            business.business_name,
          )
          .catch((err) =>
            this.logger.warn(`Failed to send team added email: ${err.message}`),
          );
      }

      // Deliberately owner-only: who is on the team is an owner's business,
      // not something to tell the team about each other. Resolved through the
      // team records rather than created_by, which is the same lookup every
      // other vendor notification now uses.
      const owner = await this.vendorRecipients.owner(
        (business as any)._id?.toString(),
      );
      if (owner) {
      this.notificationsService.create({
        recipient: owner.userId,
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
      }

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
    // Match `business` whether it's stored as an ObjectId or a legacy string —
    // team-member docs were created with a string-typed business, which an
    // ObjectId-equality filter silently misses (empty "users & permissions").
    const members = await this.teamMemberModel
      .find({ $expr: { $eq: [{ $toString: '$business' }, String(businessId)] } })
      .populate('user', 'full_name email must_change_password')
      .populate('role', 'name description');
    return members;
  }

  async updateMember(
    teamId: string,
    businessId: string,
    dto: {
      full_name?: string;
      phone_number?: string;
      role?: string;
      is_active?: boolean;
    },
  ) {
    // Scope to the caller's business so a vendor can only edit their own team.
    const member = await this.teamMemberModel.findOne({
      _id: new Types.ObjectId(teamId),
      ...ObjectIdUtils.refMatch('business', businessId),
    });
    if (!member) throw new NotFoundException('Team member not found');
    if (member.is_owner) {
      throw new BadRequestException('The business owner cannot be edited here.');
    }

    if (dto.full_name !== undefined) member.full_name = dto.full_name;
    if (dto.phone_number !== undefined) member.phone_number = dto.phone_number;
    if (dto.is_active !== undefined) member.is_active = dto.is_active;
    if (dto.role !== undefined) {
      member.role = ObjectIdUtils.toObjectId(dto.role) as Types.ObjectId;
    }

    await member.save();

    // Deactivated while this store is the one they have open: move them to
    // another store they still work in, so their next sign-in lands there.
    if (dto.is_active === false && member.user) {
      const user = await this.userModel.findById(member.user);
      if (user && String(user.business) === String(member.business)) {
        const next = await this.teamMemberModel.findOne({
          user: member.user,
          _id: { $ne: member._id },
          is_active: { $ne: false },
        });
        await this.userModel.findByIdAndUpdate(member.user, {
          business: next ? next.business : null,
        });
      }
    }

    return { message: 'Team member updated successfully', data: member };
  }

  /**
   * Send a fresh temporary password to a member who has not signed in and
   * set their own yet (the first email was lost, or the password forgotten).
   * Someone who already chose a password resets it from sign-in instead.
   */
  async resendInvite(teamId: string, business: BusinessDocument) {
    const member = await this.teamMemberModel
      .findOne({
        _id: new Types.ObjectId(teamId),
        ...ObjectIdUtils.refMatch('business', String(business.id)),
      })
      .populate('role', 'name');
    if (!member) throw new NotFoundException('Team member not found');
    if (member.is_owner) {
      throw new BadRequestException('The business owner has no invite to resend.');
    }
    if (member.is_active === false) {
      throw new BadRequestException(
        'Reactivate this member before sending their invite again.',
      );
    }

    const user = member.user ? await this.userModel.findById(member.user) : null;
    if (!user) throw new NotFoundException('This member has no account yet.');
    if (!user.must_change_password) {
      throw new BadRequestException(
        `${member.full_name} has already set their own password. They can use "Forgot password" on the sign-in page.`,
      );
    }

    const tempPassword = randomBytes(6).toString('hex');
    user.hashed_password = await bcrypt.hash(tempPassword, 10);
    await user.save();

    await this.mailService.sendTeamInviteEmail(
      member.email,
      member.full_name,
      (member.role as any)?.name ?? 'team member',
      business.business_name,
      tempPassword,
    );

    return { message: `A new invite has been sent to ${member.email}.` };
  }

  async removeMember(teamId: string, scopeBusinessId?: string) {
    const team = scopeBusinessId
      ? await this.teamMemberModel.findOne({
          _id: new Types.ObjectId(teamId),
          ...ObjectIdUtils.refMatch('business', scopeBusinessId),
        })
      : await this.teamMemberModel.findById(teamId);
    if (!team) throw new NotFoundException('Team member not found');
    if (team.is_owner) {
      throw new BadRequestException('The business owner cannot be removed.');
    }

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
