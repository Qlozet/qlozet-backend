import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PermissionDocument,
  Role,
  RoleDocument,
  User,
  UserDocument,
} from '../../modules/ums/schemas';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions',
      context.getHandler(),
    );

    if (!requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new ForbiddenException('No token provided');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'your-secret-key',
      });

      // Get user with role reference
      const user = await this.userModel
        .findById(payload.id)
        .populate<{ role: RoleDocument }>('role')
        .exec();

      if (!user || !user.role) {
        throw new ForbiddenException('User or role not found');
      }

      // Get role with populated permissions
      const roleWithPermissions = await this.roleModel
        .findById(user.role._id)
        .populate<{ permissions: PermissionDocument[] }>('permissions')
        .exec();

      if (!roleWithPermissions || !roleWithPermissions.permissions) {
        throw new ForbiddenException('Role or permissions not found');
      }

      // Now we can safely access permission names
      const userPermissions = roleWithPermissions.permissions.map(
        (permission) => permission.name,
      );

      // Check if user has all required permissions
      const hasAllPermissions = requiredPermissions.every((permission) =>
        userPermissions.includes(permission),
      );

      if (!hasAllPermissions) {
        throw new ForbiddenException(
          `Insufficient permissions. Required: ${requiredPermissions.join(', ')}. You have: ${userPermissions.join(', ')}`,
        );
      }

      // Attach user to request for use in controllers
      request.user = user;

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException('Invalid token or insufficient permissions');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
