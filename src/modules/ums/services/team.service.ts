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
import { Role, RoleDocument, RoleType } from '../schemas/role.schema';
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

  /**
   * A role the owner may hand out: a vendor role, never owner. The app hides
   * owner, but the API used to take any role id (owner, or even a staff
   * role), and an "owner" member skips every permission check.
   */
  private async assignableRole(roleId: string, session?: any) {
    const role = Types.ObjectId.isValid(roleId)
      ? await this.roleModel.findById(roleId).session(session ?? null)
      : null;
    if (!role || role.type !== RoleType.VENDOR) {
      throw new BadRequestException('Choose one of the team roles.');
    }
    if (String(role.name).toLowerCase() === VendorRole.OWNER) {
      throw new BadRequestException(
        'A store has one owner. Choose another role for this member.',
      );
    }
    return role;
  }

  async inviteTeamMember(
    dto: InviteTeamMemberDto,
    inviter: UserDocument,
    business: BusinessDocument,
  ) {
    const role = await this.assignableRole(dto.role);

    // Who this is, by EMAIL only. Matching by phone too could attach someone
    // else's account (a typo, or a shared shop phone) under this email.
    const sameEmail = await this.userModel
      .find({ email: dto.email })
      .select('+hashed_password');
    if (sameEmail.some((u) => u.type === UserType.PLATFORM)) {
      throw new BadRequestException(
        `${dto.email} belongs to a Qlozet staff account. Invite a different email address.`,
      );
    }
    let user: UserDocument | null =
      sameEmail.find((u) => u.type === UserType.VENDOR) ?? null;
    if (user && user.status && user.status !== 'active') {
      throw new BadRequestException(
        `${dto.email} belongs to an account that has been closed. Invite a different email address.`,
      );
    }

    // A number already on another person's store account is refused, not
    // used to find them.
    if (dto.phone_number) {
      const holder = await this.userModel.findOne({
        phone_number: dto.phone_number,
        type: UserType.VENDOR,
      });
      if (holder && String(holder._id) !== String(user?._id)) {
        throw new BadRequestException(
          'That phone number belongs to another Qlozet account. Leave it empty or use a different number.',
        );
      }
    }

    if (user) {
      const already = await this.teamMemberModel.findOne({
        ...ObjectIdUtils.refMatch('business', String(business.id)),
        ...ObjectIdUtils.refMatch('user', String(user._id)),
      });
      if (already) {
        throw new BadRequestException(
          already.is_active === false
            ? `${already.full_name} is already on this team but switched off. Use Reactivate on their row.`
            : `${already.full_name} is already a member of this team.`,
        );
      }
    }

    // Only a brand-NEW person gets a temporary password; anyone who already
    // has a Qlozet login keeps it.
    let tempPassword: string | null = null;
    let isNewUser = false;
    let teamMember: TeamMemberDocument;

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      if (!user) {
        // Someone who shops on Qlozet: a store account on the same email and
        // password (modules/auth/linked-accounts.ts). Without a password
        // (Google only) they're treated as new and get a temporary one.
        const shopper = sameEmail.find((u) => u.type === UserType.CUSTOMER);
        if (shopper?.hashed_password) {
          user = new this.userModel({
            full_name: shopper.full_name || dto.full_name,
            email: dto.email,
            ...(dto.phone_number && { phone_number: dto.phone_number }),
            hashed_password: shopper.hashed_password,
            business: ObjectIdUtils.toObjectId(business.id),
            role: role._id,
            type: UserType.VENDOR,
            email_verified: shopper.email_verified === true,
            status: 'active',
          });
        } else {
          isNewUser = true;
          tempPassword = randomBytes(6).toString('hex');
          user = new this.userModel({
            full_name: dto.full_name,
            email: dto.email,
            ...(dto.phone_number && { phone_number: dto.phone_number }),
            hashed_password: await bcrypt.hash(tempPassword, 10),
            business: ObjectIdUtils.toObjectId(business.id),
            role: role._id,
            type: UserType.VENDOR,
            email_verified: true,
            status: 'active',
            must_change_password: true,
          });
        }
        await user.save({ session });
      } else if (!user.business) {
        // Someone already on another store's team keeps that store open and
        // switches here from the store picker; an account with no store yet
        // (e.g. removed from their last one) is pointed here.
        user.business = ObjectIdUtils.toObjectId(business.id) as Types.ObjectId;
        await user.save({ session });
      }

      teamMember = new this.teamMemberModel({
        business: ObjectIdUtils.toObjectId(business.id),
        role: role._id,
        user: user._id,
        // The account's own name and email, so the row and every email agree
        // with who actually signs in.
        email: user.email,
        full_name: isNewUser ? dto.full_name : user.full_name || dto.full_name,
        ...((dto.phone_number || user.phone_number) && {
          phone_number: dto.phone_number || user.phone_number,
        }),
        invited_by: ObjectIdUtils.toObjectId(inviter.id),
        accepted: true,
        is_owner: false,
        is_active: true,
      });
      await teamMember.save({ session });

      await this.businessModel.findByIdAndUpdate(
        business.id,
        { $addToSet: { team_members: teamMember._id } },
        { session },
      );

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`Invite team member failed: ${error.message}`, error.stack);
      if (error?.code === 11000) {
        throw new BadRequestException(
          'That email or phone number is already on another Qlozet store account.',
        );
      }
      throw error;
    } finally {
      session.endSession();
    }

    // Everything below runs after the commit: the member IS added, so nothing
    // here may turn that into an error.
    const name = teamMember.full_name;
    let emailSent = true;
    try {
      if (isNewUser && tempPassword) {
        await this.mailService.sendTeamInviteEmail(
          user.email,
          name,
          role.name,
          business.business_name,
          tempPassword,
        );
      } else {
        await this.mailService.sendTeamAddedEmail(
          user.email,
          name,
          role.name,
          business.business_name,
        );
      }
    } catch (err: any) {
      emailSent = false;
      this.logger.warn(`Failed to send team invite email: ${err?.message}`);
    }

    // Owner-only: who is on the team is the owner's business.
    try {
      const owner = await this.vendorRecipients.owner(String((business as any)._id));
      if (owner) {
        await this.notificationsService.create({
          recipient: owner.userId,
          recipient_business: String((business as any)._id),
          category: NotificationCategory.TEAM,
          type: NotificationType.TEAM_MEMBER_JOINED,
          title: 'New Team Member Added',
          body: `${name} has been invited as ${role.name}.`,
          metadata: { member_name: name, member_email: user.email, role: role.name },
          action_url: '/settings',
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to create team notification: ${err?.message}`);
    }

    return {
      message: !emailSent
        ? `${name} was added, but we couldn't send their invite email. Use Resend invite on their row.`
        : isNewUser
          ? `${name} is invited. They'll get an email with a temporary password.`
          : `${name} is added. They sign in with their existing Qlozet password.`,
      // Never the user document: it holds the password hash.
      data: { email_sent: emailSent, teamMember },
    };
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
      const role = await this.assignableRole(dto.role);
      member.role = role._id as Types.ObjectId;
    }

    await member.save();

    // The member's open store is left as it is. Moving it here used to switch
    // a signed-in member to another store mid-session while their screen
    // still showed this one; now their next action is refused with "the
    // store owner has turned off your access", and their next sign-in picks
    // a store they can still use. Reactivating needs nothing undone.

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

    // To the ACCOUNT's email, never the team row's copy: a new password for
    // an account must only ever go to that account's own inbox.
    await this.mailService.sendTeamInviteEmail(
      user.email,
      member.full_name,
      (member.role as any)?.name ?? 'team member',
      business.business_name,
      tempPassword,
    );

    return { message: `A new invite has been sent to ${user.email}.` };
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

    const businessId = team.business;

    // Delete the team member record
    await team.deleteOne();

    // Remove from business.team_members array
    await this.businessModel.findByIdAndUpdate(businessId, {
      $pull: { team_members: team._id },
    });

    // Their open store is left as it is (see updateMember): their next
    // action here is refused, and their next sign-in picks a store they're
    // still on. Their Qlozet account stays, so they can be invited again.

    return { message: `${team.full_name} has been removed from the team.` };
  }
}
