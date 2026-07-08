import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  Role,
  RoleDocument,
} from '../../modules/ums/schemas';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../modules/ums/schemas/team.schema';
import { UserType } from '../../modules/ums/schemas/user.schema';
import { VendorRole } from '../../modules/ums/schemas/role.schema';
import { VENDOR_ROLES_KEY } from '../decorators/vendor-roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    // If no @Roles() metadata, allow access
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) throw new UnauthorizedException('Authentication token missing');

    // ✅ Verify JWT
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // ✅ Fetch full user
    const user = await this.userModel
      .findById(payload.id)
      .populate({
        path: 'role',
        select: 'name type',
      })
      .populate({
        path: 'business',
        populate: {
          path: 'team_members',
          populate: {
            path: 'role',
            select: 'name type',
          },
        },
      })
      .exec();

    if (!user) throw new UnauthorizedException('User not found');
    const normalizedRequiredRoles = requiredRoles.map((r) =>
      r.toString().toLowerCase(),
    );

    // ✅ Step 2: Check Platform roles
    if (user.type === UserType.PLATFORM) {
      const role = (user as any).role as RoleDocument | undefined;
      if (!role) {
        throw new ForbiddenException('No role assigned to platform user');
      }

      // Platform admins have full access to all endpoints
      const adminRoles = ['admin', 'super_admin'];
      if (adminRoles.includes(role.name.toLowerCase())) {
        request.user = user;
        return true;
      }

      const hasRole = normalizedRequiredRoles.includes(role.name.toLowerCase());
      if (!hasRole) {
        throw new ForbiddenException(
          `Access denied — requires one of: ${requiredRoles.join(', ')}`,
        );
      }

      return true;
    }

    // ✅ Step 3: Check Vendor roles (team members)
    if (user.type === UserType.VENDOR) {
      const business: any = user.business;
      const members: TeamMemberDocument[] = business?.team_members || [];

      if (!members?.length) {
        throw new ForbiddenException('No active team members found for vendor');
      }

      // Check that @Roles() includes 'vendor' (the user type)
      if (!normalizedRequiredRoles.includes(UserType.VENDOR.toLowerCase())) {
        throw new ForbiddenException(
          `Access denied — requires one of: ${requiredRoles.join(', ')}`,
        );
      }

      // Find the CURRENT user's team member record
      const currentMember = members.find(
        (tm: any) => tm.user?.toString() === (user._id as any).toString(),
      );

      if (!currentMember) {
        throw new ForbiddenException(
          'You are not a member of this business team',
        );
      }

      const memberRole = (currentMember as any).role as
        | RoleDocument
        | undefined;
      const memberRoleName = memberRole?.name?.toLowerCase() || '';

      // Owner always has full access — never locked out
      const isOwner = memberRoleName === VendorRole.OWNER.toLowerCase();

      // Check @VendorRoles() for granular role enforcement
      const requiredVendorRoles = this.reflector.get<string[]>(
        VENDOR_ROLES_KEY,
        context.getHandler(),
      );

      if (requiredVendorRoles?.length && !isOwner) {
        const normalizedVendorRoles = requiredVendorRoles.map((r) =>
          r.toLowerCase(),
        );

        if (!normalizedVendorRoles.includes(memberRoleName)) {
          throw new ForbiddenException(
            `Access denied — your role "${memberRoleName}" is not authorized. ` +
              `Required: ${requiredVendorRoles.join(', ')}`,
          );
        }
      }

      // Attach context to request
      request.user = user;
      request.team_members = members;
      request.business = business;
      request.currentMember = currentMember;
      request.vendorRole = memberRoleName;

      return true;
    }

    // ✅ Step 4: Customer routes
    if (user.type === UserType.CUSTOMER) {
      if (normalizedRequiredRoles.includes(UserType.CUSTOMER.toLowerCase())) {
        request.user = user;
        return true;
      }
      throw new ForbiddenException('Customer access denied for this route');
    }

    throw new ForbiddenException('Invalid user type');
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }
    return undefined;
  }
}

