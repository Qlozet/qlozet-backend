import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserDocument,
  Role,
  RoleDocument,
  User,
  Permission,
  PermissionDocument,
} from '../schemas';
import {
  CONSOLE_ACTIONS,
  CONSOLE_RESOURCES,
  ConsoleAction,
  consolePermissionName,
  consolePermissionSeeds,
} from '../constants/console-permissions';

/** One row of the console's Edit Access grid. */
export interface ConsolePermissionGroup {
  resource: string;
  label: string;
  module: string;
  /** Permission id per action — what the role's `permissions` array holds. */
  actions: Record<ConsoleAction, string | null>;
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(Permission.name)
    private permissionModel: Model<PermissionDocument>,
  ) {}

  /**
   * The module x action grid the console's Edit Access screen renders, with the
   * real permission id behind every cell.
   *
   * Missing cells are created on read. A permission catalogue is reference
   * data, not user data: the set is fixed by CONSOLE_RESOURCES, the insert is
   * idempotent, and doing it here means the screen works on an environment
   * where the seeder has never been run rather than rendering an empty grid.
   * After the first call nothing is written.
   */
  async getConsoleCatalogue(): Promise<ConsolePermissionGroup[]> {
    const names = CONSOLE_RESOURCES.flatMap((resource) =>
      CONSOLE_ACTIONS.map((action) =>
        consolePermissionName(resource.key, action),
      ),
    );

    let existing = await this.permissionModel
      .find({ name: { $in: names } })
      .select('name resource action')
      .lean();

    if (existing.length < names.length) {
      const have = new Set(existing.map((permission) => permission.name));
      const missing = consolePermissionSeeds().filter(
        (seed) => !have.has(seed.name),
      );

      try {
        await this.permissionModel.insertMany(missing, { ordered: false });
        this.logger.log(
          `Created ${missing.length} console permission(s): ${missing
            .map((seed) => seed.name)
            .join(', ')}`,
        );
      } catch (error) {
        // A concurrent request may have inserted the same names first; the
        // unique index rejecting a duplicate is the expected outcome, not a
        // failure worth propagating to the screen.
        this.logger.warn(
          `Console permission backfill partially skipped: ${error.message}`,
        );
      }

      existing = await this.permissionModel
        .find({ name: { $in: names } })
        .select('name resource action')
        .lean();
    }

    const byName = new Map(
      existing.map((permission) => [permission.name, String(permission._id)]),
    );

    return CONSOLE_RESOURCES.map((resource) => ({
      resource: resource.key,
      label: resource.label,
      module: resource.module,
      actions: CONSOLE_ACTIONS.reduce(
        (actions, action) => {
          actions[action] =
            byName.get(consolePermissionName(resource.key, action)) ?? null;
          return actions;
        },
        {} as Record<ConsoleAction, string | null>,
      ),
    }));
  }

  /** Every permission id the console grid covers, for "grant everything". */
  async getConsolePermissionIds(resourceKeys?: string[]): Promise<string[]> {
    const catalogue = await this.getConsoleCatalogue();
    return catalogue
      .filter(
        (group) => !resourceKeys || resourceKeys.includes(group.resource),
      )
      .flatMap((group) =>
        Object.values(group.actions).filter((id): id is string => Boolean(id)),
      );
  }

  async userHasPermissions(
    userId: Types.ObjectId,
    requiredPermissions: string[],
  ): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .populate<{ role: RoleDocument }>('role')
      .exec();

    if (!user || !user.role) {
      return false;
    }

    const roleWithPermissions = await this.roleModel
      .findById(user.role._id)
      .populate<{ permissions: PermissionDocument[] }>('permissions')
      .exec();

    if (!roleWithPermissions || !roleWithPermissions.permissions) {
      return false;
    }

    const userPermissions = roleWithPermissions.permissions.map((p) => p.name);
    return requiredPermissions.every((permission) =>
      userPermissions.includes(permission),
    );
  }

  async getUserPermissions(userId: Types.ObjectId): Promise<string[]> {
    const user = await this.userModel
      .findById(userId)
      .populate<{ role: RoleDocument }>('role')
      .exec();

    if (!user || !user.role) {
      return [];
    }

    const roleWithPermissions = await this.roleModel
      .findById(user.role._id)
      .populate<{ permissions: PermissionDocument[] }>('permissions')
      .exec();

    if (!roleWithPermissions || !roleWithPermissions.permissions) {
      return [];
    }

    return roleWithPermissions.permissions.map((p) => p.name);
  }
}
