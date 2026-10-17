import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument, User, UserDocument } from '../../modules/ums/schemas';
import { UserType } from '../../modules/ums/schemas/user.schema';
import {
  FULL_ACCESS_ROLES,
  deniedMessage,
  isConsoleOnlyPath,
  normalisePath,
  passwordChangeAllowed,
  permits,
  resolveConsoleCell,
} from '../access/console-access';

export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/** What the guard learned, for handlers that want it (set on the request). */
export interface ConsoleAccess {
  roleName: string;
  fullAccess: boolean;
  permissions: string[];
}

/**
 * Makes the admin console's permission grid real.
 *
 * Runs globally after the JWT guard. For a platform (staff) user it refuses a
 * deactivated account, holds everything but the password routes while a
 * temporary password is still in use, lets super admins and admins through,
 * and checks every other role against the grid cell the request needs. For
 * customers and vendors it only refuses the console-only routes; the rest of
 * their traffic is untouched and the controller-level RolesGuard still applies.
 */
@Injectable()
export class ConsoleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id ?? request.user?._id;
    // No verified token: the JWT guard already answered, or will.
    if (!userId) return true;

    const method = String(request.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') return true;
    const path = normalisePath(request.originalUrl || request.url || '');

    const user: any = await this.userModel
      .findById(userId)
      .select('type role status must_change_password')
      .lean();
    if (!user) return true;

    if (user.type !== UserType.PLATFORM) {
      if (isConsoleOnlyPath(path)) {
        throw new ForbiddenException('This area is for Qlozet staff only.');
      }
      return true;
    }

    if (user.status !== 'active') {
      throw new ForbiddenException(
        'Your admin account has been deactivated. Contact a super admin.',
      );
    }

    if (user.must_change_password && !passwordChangeAllowed(path)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: PASSWORD_CHANGE_REQUIRED,
        message: 'Set a new password to continue.',
      });
    }

    const role: any = user.role
      ? await this.roleModel
          .findById(user.role)
          .select('name permissions')
          .populate('permissions', 'name')
          .lean()
      : null;
    if (!role) {
      throw new ForbiddenException(
        'No role is assigned to your account. Ask a super admin to set one.',
      );
    }

    const roleName = String(role.name || '').toLowerCase();
    const permissions: string[] = (role.permissions ?? [])
      .map((p: any) => (typeof p === 'string' ? '' : p?.name))
      .filter(Boolean);
    const fullAccess = FULL_ACCESS_ROLES.has(roleName);
    request.consoleAccess = { roleName, fullAccess, permissions } as ConsoleAccess;

    if (fullAccess) return true;

    const cell = resolveConsoleCell(method, path);
    if (!cell) return true;
    if (permits(permissions, cell)) return true;

    throw new ForbiddenException(deniedMessage(roleName, cell));
  }
}
