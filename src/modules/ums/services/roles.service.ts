// src/roles/roles.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Role,
  RoleDocument,
  RoleType,
  PlatformRole,
  VendorRole,
  PermissionDocument,
} from '../schemas';
import { PermissionService } from './permissions.service';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
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

  async findAll(): Promise<RoleDocument[]> {
    return this.roleModel.find().populate('permissions').exec();
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
    const result = await this.roleModel.findByIdAndDelete(id).exec();

    if (!result) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
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
