import { Injectable } from '@nestjs/common';
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

@Injectable()
export class PermissionService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
  ) {}

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
