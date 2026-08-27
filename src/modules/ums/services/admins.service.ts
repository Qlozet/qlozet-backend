import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserType } from '../schemas/user.schema';
import { Role, RoleDocument, RoleType } from '../schemas/role.schema';
import { MailService } from '../../notifications/mail/mail.service';
import { Utils } from 'src/common/utils/pagination';
import {
  AdminStatus,
  CreateAdminDto,
  FetchAdminsDto,
  UpdateAdminDto,
} from '../dto/admin.dto';

/** Role names are stored lowercased; the console sends "Super admin". */
const normalizeRoleName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const SUPER_ADMIN = 'super_admin';

/** A populated `role` ref, as both the lean rows and the documents carry it. */
interface RoleRef {
  _id: unknown;
  name?: string | null;
  description?: string | null;
}

/** The fields `shape` reads — a lean row or a hydrated document alike. */
interface AdminSource {
  _id: unknown;
  full_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  status?: string | null;
  role?: unknown;
  profile_picture?: string | null;
  last_login_at?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

const isRoleRef = (value: unknown): value is RoleRef =>
  typeof value === 'object' && value !== null && '_id' in value;

/**
 * Platform administrators — the people who sign in to the admin console.
 *
 * Distinct from TeamService, which manages a VENDOR's team: those records are
 * scoped to a business and live in the `teammembers` collection. A platform
 * admin has no business; they are a User with `type: 'platform'` and a
 * platform-typed Role, which is exactly what `loginPlatform` authenticates.
 */
@Injectable()
export class AdminsService {
  private readonly logger = new Logger(AdminsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------

  async list(filters: FetchAdminsDto) {
    const page = Number(filters?.page) || 1;
    const size = Number(filters?.size) || 10;

    const query: FilterQuery<UserDocument> = { type: UserType.PLATFORM };

    if (filters?.search) {
      // Escaped: a phone search for "+234…" is otherwise an invalid pattern and
      // "." would match any character.
      const escaped = filters.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      query.$or = [
        { full_name: rx },
        { email: rx },
        { phone_number: rx },
        { username: rx },
      ];
    }

    if (filters?.status) query.status = filters.status;

    if (filters?.role) {
      const role = await this.findRole(filters.role);
      // A filter on a role that does not exist matches nothing, rather than
      // silently listing every admin.
      query.role = role ? role._id : new Types.ObjectId();
    }

    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.userModel
        .find(query)
        .select(
          'full_name email phone_number username status role createdAt updatedAt last_login_at profile_picture',
        )
        .populate('role', 'name description type level')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .lean(),
      this.userModel.countDocuments(query),
    ]);

    return Utils.getPagingData(
      { count, rows: rows.map((row) => this.shape(row)) },
      page,
      size,
    );
  }

  async findOne(id: string) {
    const admin = await this.getAdminOr404(id);
    return this.shape(admin);
  }

  // ---------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------

  async create(dto: CreateAdminDto, invitedBy?: { full_name?: string }) {
    const role = await this.requirePlatformRole(dto.role);

    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone_number?.trim();

    // `email` and `phone_number` are unique across ALL users, so a clash with a
    // customer or vendor account fails the same way — say which field it was
    // rather than letting Mongo's E11000 surface as a 500.
    const clash = await this.userModel
      .findOne({
        $or: [{ email }, ...(phone ? [{ phone_number: phone }] : [])],
      })
      .select('email phone_number type')
      .lean();

    if (clash) {
      throw new ConflictException(
        clash.email === email
          ? 'An account with that email address already exists.'
          : 'An account with that phone number already exists.',
      );
    }

    const temporaryPassword = randomBytes(6).toString('hex');

    const admin = await this.userModel.create({
      full_name: dto.full_name.trim(),
      email,
      ...(phone && { phone_number: phone }),
      hashed_password: await bcrypt.hash(temporaryPassword, 10),
      type: UserType.PLATFORM,
      role: role._id,
      status: 'active',
      email_verified: true,
      must_change_password: true,
    });

    // Best-effort: the admin exists either way, and a mail outage must not roll
    // back the account that was just created.
    this.mailService
      .sendAdminInviteEmail(
        email,
        admin.full_name,
        role.name,
        temporaryPassword,
        invitedBy?.full_name,
      )
      .catch((error: Error) =>
        this.logger.warn(`Failed to send admin invite email: ${error.message}`),
      );

    const created = await this.getAdminOr404(String(admin._id));

    return {
      message: 'Admin added successfully',
      data: this.shape(created),
    };
  }

  async update(id: string, dto: UpdateAdminDto, actorId?: string) {
    const admin = await this.getAdminOr404(id);

    if (dto.full_name !== undefined) admin.full_name = dto.full_name.trim();

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== admin.email) {
        const clash = await this.userModel
          .findOne({ email, _id: { $ne: admin._id } })
          .select('_id')
          .lean();
        if (clash) {
          throw new ConflictException(
            'An account with that email address already exists.',
          );
        }
        admin.email = email;
      }
    }

    if (dto.phone_number !== undefined) {
      const phone = dto.phone_number.trim();
      if (phone) {
        const clash = await this.userModel
          .findOne({ phone_number: phone, _id: { $ne: admin._id } })
          .select('_id')
          .lean();
        if (clash) {
          throw new ConflictException(
            'An account with that phone number already exists.',
          );
        }
        admin.phone_number = phone;
      } else {
        // Unset rather than store "": the unique index would reject a second
        // admin with an empty string.
        admin.set('phone_number', undefined);
      }
    }

    if (dto.role !== undefined) {
      const role = await this.requirePlatformRole(dto.role);
      if (String(role._id) !== String(admin.role)) {
        await this.assertSuperAdminRemains(admin, 'role');
      }
      admin.role = role._id as Types.ObjectId;
    }

    if (dto.status !== undefined && dto.status !== admin.status) {
      this.assertNotSelf(admin, actorId, 'change your own account status');
      if (dto.status !== 'active') {
        await this.assertSuperAdminRemains(admin, 'status');
      }
      admin.status = dto.status;
    }

    await admin.save();

    return {
      message: 'Admin updated successfully',
      data: this.shape(await this.getAdminOr404(id)),
    };
  }

  async setStatus(id: string, status: AdminStatus, actorId?: string) {
    const result = await this.update(id, { status }, actorId);
    return {
      message: status === 'active' ? 'Admin reactivated' : 'Admin deactivated',
      data: result.data,
    };
  }

  async remove(id: string, actorId?: string) {
    const admin = await this.getAdminOr404(id);

    this.assertNotSelf(admin, actorId, 'delete your own account');
    await this.assertSuperAdminRemains(admin, 'delete');

    await admin.deleteOne();

    return { message: 'Admin removed successfully' };
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  /** A platform user by id, whatever their role. */
  private async getAdminOr404(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Admin not found');
    }

    const admin = await this.userModel
      .findOne({ _id: new Types.ObjectId(id), type: UserType.PLATFORM })
      .populate('role', 'name description type level');

    if (!admin) throw new NotFoundException('Admin not found');
    return admin;
  }

  /** Resolve a role by id or by name, so the console can send either. */
  private async findRole(idOrName: string): Promise<RoleDocument | null> {
    const value = idOrName?.trim();
    if (!value) return null;

    if (Types.ObjectId.isValid(value)) {
      const byId = await this.roleModel.findById(value);
      if (byId) return byId;
    }

    return this.roleModel.findOne({ name: normalizeRoleName(value) });
  }

  private async requirePlatformRole(idOrName: string): Promise<RoleDocument> {
    const role = await this.findRole(idOrName);
    if (!role) throw new BadRequestException('That role does not exist.');
    if (role.type !== RoleType.PLATFORM) {
      throw new BadRequestException(
        `"${role.name}" is a vendor role — an administrator needs a platform role.`,
      );
    }
    return role;
  }

  private assertNotSelf(
    admin: UserDocument,
    actorId: string | undefined,
    action: string,
  ) {
    if (actorId && String(admin._id) === String(actorId)) {
      throw new BadRequestException(`You cannot ${action}.`);
    }
  }

  /**
   * Refuse the change when it would leave the platform with no active super
   * admin — nobody could then grant the role back.
   */
  private async assertSuperAdminRemains(
    admin: UserDocument,
    change: 'role' | 'status' | 'delete',
  ) {
    const role = isRoleRef(admin.role) ? admin.role : null;
    const roleName = normalizeRoleName(role?.name ?? '');
    if (roleName !== SUPER_ADMIN || admin.status !== 'active') return;

    const superAdminRoleIds = await this.roleModel
      .find({ name: SUPER_ADMIN, type: RoleType.PLATFORM })
      .select('_id')
      .lean();

    const remaining = await this.userModel.countDocuments({
      _id: { $ne: admin._id },
      type: UserType.PLATFORM,
      status: 'active',
      role: { $in: superAdminRoleIds.map((r) => r._id) },
    });

    if (remaining === 0) {
      const verb =
        change === 'delete'
          ? 'Deleting'
          : change === 'status'
            ? 'Deactivating'
            : 'Changing the role of';
      throw new BadRequestException(
        `${verb} the last active super admin would lock everyone out of the console.`,
      );
    }
  }

  /** One row of the Administrators table. */
  private shape(admin: AdminSource) {
    // `role` is an id until it is populated; only a populated one has a name.
    const role = isRoleRef(admin.role) ? admin.role : null;

    return {
      _id: String(admin._id),
      full_name: admin.full_name ?? null,
      email: admin.email ?? null,
      phone_number: admin.phone_number ?? null,
      status: admin.status ?? 'active',
      role: role
        ? {
            _id: String(role._id),
            name: role.name ?? null,
            description: role.description ?? null,
          }
        : null,
      // Flattened too: the table renders a role name, and reading it through
      // one key means a row still shows something if the ref ever dangles.
      role_name: role?.name ?? null,
      profile_picture: admin.profile_picture ?? null,
      last_login_at: admin.last_login_at ?? null,
      createdAt: admin.createdAt ?? null,
      updatedAt: admin.updatedAt ?? null,
    };
  }
}
