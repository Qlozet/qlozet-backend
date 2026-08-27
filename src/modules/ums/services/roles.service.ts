// src/roles/roles.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Role,
  RoleDocument,
  RoleType,
  PlatformRole,
  VendorRole,
  PermissionDocument,
  User,
  UserDocument,
  UserType,
} from '../schemas';
import { PermissionService } from './permissions.service';
import { CONSOLE_PLATFORM_ROLES } from '../constants/console-permissions';
import { CreateRoleDto, UpdateRoleDto } from '../dto/roles.dto';

/** Role names are stored lowercased; the console sends "Super admin". */
const normalizeRoleName = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, '_');

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private permissionsService: PermissionService,
  ) {}

  async findByName(name: string): Promise<RoleDocument | null> {
    return this.roleModel.findOne({ name }).populate('permissions').exec();
  }

  async create(roleData: Partial<Role>): Promise<RoleDocument> {
    const role = new this.roleModel(roleData);
    return role.save();
  }

  async getDefaultVendorRole(): Promise<RoleDocument> {
    const role = await this.roleModel
      .findOne({ type: RoleType.VENDOR, isDefault: true })
      .populate('permissions')
      .exec();

    if (!role) {
      throw new NotFoundException('Default vendor role not found');
    }

    return role;
  }

  async getDefaultVendorRoleOrNull(): Promise<RoleDocument | null> {
    return this.roleModel
      .findOne({ type: RoleType.VENDOR, isDefault: true })
      .populate('permissions')
      .exec();
  }

  async findByType(type: RoleType): Promise<RoleDocument[]> {
    return this.roleModel.find({ type }).populate('permissions').exec();
  }

  async getVendorRoles(): Promise<RoleDocument[]> {
    return this.roleModel
      .find({
        type: RoleType.VENDOR,
        name: { $ne: 'Owner' }, // exclude owner
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  async getPlatformRoles(): Promise<RoleDocument[]> {
    return this.findByType(RoleType.PLATFORM);
  }

  async findById(id: string): Promise<RoleDocument> {
    const role = await this.roleModel
      .findById(id)
      .populate('permissions')
      .exec();

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async findByIdOrNull(id: string): Promise<RoleDocument | null> {
    return this.roleModel.findById(id).populate('permissions').exec();
  }

  async findAll(type?: RoleType): Promise<RoleDocument[]> {
    return this.roleModel
      .find(type === RoleType.PLATFORM ? this.platformRoleFilter() : type ? { type } : {})
      .populate('permissions')
      .sort({ level: 1, createdAt: 1 })
      .exec();
  }

  /**
   * Platform roles a platform USER can actually hold.
   *
   * `type: platform` alone is not that set: the seeded 'customer' role is
   * platform-typed but `allowed_user_types: ['customer']`, so it showed up in
   * the console's role picker — and granting it would make an administrator
   * whose role the platform guard rejects. Roles that never declared an
   * allowed type are kept: the schema's default predates this, and excluding
   * them would silently hide real staff roles.
   */
  private platformRoleFilter() {
    return {
      type: RoleType.PLATFORM,
      $or: [
        { allowed_user_types: UserType.PLATFORM },
        { allowed_user_types: { $size: 0 } },
        { allowed_user_types: { $exists: false } },
      ],
    };
  }

  /**
   * Create a role from the console's payload.
   *
   * The DTO speaks `isDefault` while the schema stores `is_default`, so passing
   * the DTO straight through silently dropped the flag. `description` is
   * required by the schema and optional in the DTO — a role created without one
   * used to fail validation inside Mongoose and surface as a 500.
   */
  async createFromDto(dto: CreateRoleDto): Promise<RoleDocument> {
    const name = normalizeRoleName(dto.name);
    if (!name) throw new BadRequestException('A role needs a name.');

    const type = (dto.type as unknown as RoleType) ?? RoleType.PLATFORM;

    const existing = await this.roleModel.findOne({ name, type });
    if (existing) {
      throw new ConflictException(`A ${type} role called "${name}" already exists.`);
    }

    return this.create({
      name,
      type,
      description: dto.description?.trim() || 'No description yet.',
      is_default: dto.isDefault ?? false,
      allowed_user_types: [
        type === RoleType.VENDOR ? UserType.VENDOR : UserType.PLATFORM,
      ],
    });
  }

  /** Update from the console's payload, mapping `isDefault` to `is_default`. */
  async updateFromDto(id: string, dto: UpdateRoleDto): Promise<RoleDocument> {
    const role = await this.findByIdOrNull(id);
    if (!role) throw new NotFoundException(`Role with ID ${id} not found`);

    const update: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = normalizeRoleName(dto.name);
      if (!name) throw new BadRequestException('A role needs a name.');
      if (name !== role.name) {
        const clash = await this.roleModel.findOne({
          name,
          type: role.type,
          _id: { $ne: role._id },
        });
        if (clash) {
          throw new ConflictException(
            `A ${role.type} role called "${name}" already exists.`,
          );
        }
      }
      update.name = name;
    }

    if (dto.description !== undefined) {
      update.description = dto.description.trim() || 'No description yet.';
    }

    if (dto.isDefault !== undefined) update.is_default = dto.isDefault;

    return this.updateRole(id, update as Partial<Role>);
  }

  /**
   * Replace a role's permissions with exactly this set.
   *
   * The console's grid is a full picture of what the role may do, so a save has
   * to clear the boxes that were unticked. Doing that through
   * assign + remove is two round trips that can half-apply; this is one write.
   */
  async setPermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<RoleDocument> {
    const invalid = permissionIds.filter((id) => !Types.ObjectId.isValid(id));
    if (invalid.length) {
      throw new BadRequestException(
        `Not permission ids: ${invalid.slice(0, 3).join(', ')}`,
      );
    }

    const role = await this.roleModel
      .findByIdAndUpdate(
        roleId,
        {
          permissions: permissionIds.map((id) => new Types.ObjectId(id)),
        },
        { new: true },
      )
      .populate('permissions')
      .exec();

    if (!role) throw new NotFoundException(`Role with ID ${roleId} not found`);
    return role;
  }

  /**
   * Create the platform roles the console's role picker expects, if they are
   * missing. Idempotent, and never touches a role that already exists — an
   * admin may well have renamed or re-scoped one.
   */
  async ensurePlatformDefaults(): Promise<{
    message: string;
    data: { created: string[] };
  }> {
    const created: string[] = [];

    const ensure = async (
      name: string,
      description: string,
      level: number,
      resources?: string[],
    ) => {
      const existing = await this.roleModel.findOne({
        name,
        type: RoleType.PLATFORM,
      });
      if (existing) return;

      const permissions =
        await this.permissionsService.getConsolePermissionIds(resources);

      await this.create({
        name,
        description,
        type: RoleType.PLATFORM,
        level,
        is_system: true,
        allowed_user_types: [UserType.PLATFORM],
        permissions: permissions.map(
          (id) => new Types.ObjectId(id),
        ) as unknown as Role['permissions'],
      });
      created.push(name);
    };

    await ensure(
      'super_admin',
      'Full access to every area of the console.',
      1,
    );
    await ensure(
      'admin',
      'Runs the platform day to day, short of ownership-level settings.',
      2,
    );

    for (const role of CONSOLE_PLATFORM_ROLES) {
      await ensure(role.name, role.description, role.level, [
        ...role.resources,
      ]);
    }

    // `created` sits under `data` deliberately: the response interceptor
    // promotes a top-level `message` and then re-wraps `data.data`, so a
    // sibling key next to `message` is dropped before it reaches the client.
    return {
      message: created.length
        ? `Created ${created.length} platform role(s).`
        : 'Every default platform role already exists.',
      data: { created },
    };
  }

  async updateRole(
    id: string,
    updateData: Partial<Role>,
  ): Promise<RoleDocument> {
    const role = await this.roleModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('permissions')
      .exec();

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleModel.findById(id).exec();
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    // Deleting a role that people still hold leaves their `role` ref dangling —
    // and the roles guard denies a platform user with no role, so it would lock
    // them out of the console with no way back in.
    const holders = await this.userModel.countDocuments({ role: role._id });
    if (holders > 0) {
      throw new ConflictException(
        `${holders} account${holders === 1 ? ' is' : 's are'} still assigned "${role.name}". Move them to another role first.`,
      );
    }

    if (role.is_system) {
      throw new ConflictException(
        `"${role.name}" is a built-in role and cannot be deleted.`,
      );
    }

    await role.deleteOne();
  }

  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
  ): Promise<RoleDocument> {
    const role = await this.roleModel
      .findByIdAndUpdate(
        roleId,
        { $addToSet: { permissions: { $each: permissionIds } } },
        { new: true },
      )
      .populate('permissions')
      .exec();

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    return role;
  }

  async removePermissionsFromRole(
    roleId: string,
    permissionIds: string[],
  ): Promise<RoleDocument> {
    const role = await this.roleModel
      .findByIdAndUpdate(
        roleId,
        { $pull: { permissions: { $in: permissionIds } } },
        { new: true },
      )
      .populate('permissions')
      .exec();

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    return role;
  }

  async getRolesByUserType(userType: string): Promise<RoleDocument[]> {
    let roleType: RoleType;

    switch (userType) {
      case 'platform':
        roleType = RoleType.PLATFORM;
        break;
      case 'vendor':
        roleType = RoleType.VENDOR;
        break;
      default:
        return [];
    }

    return this.findByType(roleType);
  }

  async checkUserHasPermission(
    userRoles: RoleDocument[],
    permissionName: string,
  ): Promise<boolean> {
    // First, get all role IDs
    const roleIds = userRoles.map((role) => role._id);

    // Find roles with populated permissions
    const rolesWithPermissions = await this.roleModel
      .find({ _id: { $in: roleIds } })
      .populate<{ permissions: PermissionDocument[] }>('permissions');

    for (const role of rolesWithPermissions) {
      const hasPermission = role.permissions.some(
        (permission) => permission.name === permissionName,
      );
      if (hasPermission) {
        return true;
      }
    }
    return false;
  }
}
