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
  BusinessDocument,
} from '../../modules/ums/schemas';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../modules/ums/schemas/team.schema';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const vendor = await this.userModel
      .findById(payload.id)
      .populate({
        path: 'business',
        populate: {
          path: 'team_members',
          populate: { path: 'role', select: 'name permissions' },
        },
      })
      .exec();

    const business = vendor?.business as unknown as BusinessDocument;
    const members = business?.team_members as unknown as TeamMemberDocument[];

    if (!members || members.length === 0) {
      throw new ForbiddenException(
        'No active team members found for this user',
      );
    }

    const hasRole = members.some((tm) => {
      const role = tm.role as unknown as RoleDocument;
      return requiredRoles.includes(role?.name);
    });
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied — requires one of: ${requiredRoles.join(', ')}`,
      );
    }
    request.team_members = members;
    request.business = business;

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }
    return undefined;
  }
}
