import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

// Import models and enums
import {
  User,
  UserDocument,
  UserType,
  Role,
  RoleDocument,
  RoleType,
  Permission,
  PermissionDocument,
  PermissionModule,
  Business,
  BusinessDocument,
} from '../schemas';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Permission.name)
    private permissionModel: Model<PermissionDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Business.name) private businessModel: Model<BusinessDocument>,
  ) {}

  /**
   * Run complete database seeding
   */
  async seed(): Promise<void> {
    try {
      this.logger.log('Starting complete database seeding...');

      const permissions = await this.seedPermissions();
      const roles = await this.seedRoles(permissions);
      await this.seedUsersAndBusinesses(roles);

      this.logger.log('✅ Database seeding completed successfully!');
    } catch (error) {
      this.logger.error('❌ Database seeding failed:', error);
      throw error;
    }
  }

  /**
   * Seed permissions only
   */
  async seedPermissionsOnly(): Promise<{ message: string; count: number }> {
    try {
      this.logger.log('Seeding permissions...');
      const permissions = await this.seedPermissions();
      this.logger.log(
        `✅ Permissions seeded successfully! Count: ${permissions.size}`,
      );
      return {
        message: 'Permissions seeded successfully',
        count: permissions.size,
      };
    } catch (error) {
      this.logger.error('❌ Permissions seeding failed:', error);
      throw error;
    }
  }

  /**
   * Seed roles only (includes permissions)
   */
  async seedRolesOnly(): Promise<{ message: string; count: number }> {
    try {
      this.logger.log('Seeding roles...');
      const permissions = await this.seedPermissions();
      const roles = await this.seedRoles(permissions);
      this.logger.log(`✅ Roles seeded successfully! Count: ${roles.size}`);
      return { message: 'Roles seeded successfully', count: roles.size };
    } catch (error) {
      this.logger.error('❌ Roles seeding failed:', error);
      throw error;
    }
  }

  /**
   * Seed users and businesses only (includes roles and permissions)
   */
  async seedUsersOnly(): Promise<{ message: string }> {
    try {
      this.logger.log('Seeding users and businesses...');
      const permissions = await this.seedPermissions();
      const roles = await this.seedRoles(permissions);
      await this.seedUsersAndBusinesses(roles);
      this.logger.log('✅ Users and businesses seeded successfully!');
      return { message: 'Users and businesses seeded successfully' };
    } catch (error) {
      this.logger.error('❌ Users seeding failed:', error);
      throw error;
    }
  }

  /**
   * Clear all database data
   */
  async clearDatabase(): Promise<{ message: string }> {
    try {
      this.logger.warn('Clearing database...');

      // Clear in reverse order to maintain referential integrity
      await this.businessModel.deleteMany({});
      await this.userModel.deleteMany({});
      await this.roleModel.deleteMany({});
      await this.permissionModel.deleteMany({});

      this.logger.log('✅ Database cleared successfully!');
      return { message: 'Database cleared successfully' };
    } catch (error) {
      this.logger.error('❌ Database clearing failed:', error);
      throw error;
    }
  }

  /**
   * Seed permissions into the database
   */
  private async seedPermissions(): Promise<Map<string, PermissionDocument>> {
    const permissionsData = [
      // User Management
      {
        category: 'users',
        name: 'view_users',
        description: 'View users list',
        action: 'read',
        resource: 'users',
        module: PermissionModule.USER_MANAGEMENT,
      },
      {
        category: 'users',
        name: 'create_users',
        description: 'Create new users',
        action: 'create',
        resource: 'users',
        module: PermissionModule.USER_MANAGEMENT,
      },
      {
        category: 'users',
        name: 'edit_users',
        description: 'Edit user information',
        action: 'update',
        resource: 'users',
        module: PermissionModule.USER_MANAGEMENT,
      },
      {
        category: 'users',
        name: 'delete_users',
        description: 'Delete users',
        action: 'delete',
        resource: 'users',
        module: PermissionModule.USER_MANAGEMENT,
      },
      {
        category: 'users',
        name: 'ban_users',
        description: 'Ban or suspend users',
        action: 'update',
        resource: 'users',
        module: PermissionModule.USER_MANAGEMENT,
      },

      // Vendor Management
      {
        category: 'vendors',
        name: 'view_vendors',
        description: 'View vendors list',
        action: 'read',
        resource: 'vendors',
        module: PermissionModule.VENDOR_MANAGEMENT,
      },
      {
        category: 'vendors',
        name: 'approve_vendors',
        description: 'Approve vendor applications',
        action: 'update',
        resource: 'vendors',
        module: PermissionModule.VENDOR_MANAGEMENT,
      },
      {
        category: 'vendors',
        name: 'suspend_vendors',
        description: 'Suspend vendor accounts',
        action: 'update',
        resource: 'vendors',
        module: PermissionModule.VENDOR_MANAGEMENT,
      },
      {
        category: 'vendors',
        name: 'feature_vendors',
        description: 'Feature vendors on platform',
        action: 'update',
        resource: 'vendors',
        module: PermissionModule.VENDOR_MANAGEMENT,
      },
      {
        category: 'vendors',
        name: 'view_vendor_analytics',
        description: 'View vendor analytics',
        action: 'read',
        resource: 'vendors',
        module: PermissionModule.VENDOR_MANAGEMENT,
      },

      // Product Management
      {
        category: 'products',
        name: 'view_products',
        description: 'View products list',
        action: 'read',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },
      {
        category: 'products',
        name: 'create_products',
        description: 'Create new products',
        action: 'create',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },
      {
        category: 'products',
        name: 'edit_products',
        description: 'Edit product information',
        action: 'update',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },
      {
        category: 'products',
        name: 'delete_products',
        description: 'Delete products',
        action: 'delete',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },
      {
        category: 'products',
        name: 'approve_products',
        description: 'Approve products',
        action: 'update',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },
      {
        category: 'products',
        name: 'feature_products',
        description: 'Feature products',
        action: 'update',
        resource: 'products',
        module: PermissionModule.PRODUCT_MANAGEMENT,
      },

      // Order Management
      {
        category: 'orders',
        name: 'view_orders',
        description: 'View orders list',
        action: 'read',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },
      {
        category: 'orders',
        name: 'create_orders',
        description: 'Create orders',
        action: 'create',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },
      {
        category: 'orders',
        name: 'edit_orders',
        description: 'Edit order details',
        action: 'update',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },
      {
        category: 'orders',
        name: 'cancel_orders',
        description: 'Cancel orders',
        action: 'update',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },
      {
        category: 'orders',
        name: 'process_refunds',
        description: 'Process order refunds',
        action: 'update',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },
      {
        category: 'orders',
        name: 'view_sales_reports',
        description: 'View sales reports',
        action: 'read',
        resource: 'orders',
        module: PermissionModule.ORDER_MANAGEMENT,
      },

      // Content Management
      {
        category: 'content',
        name: 'manage_categories',
        description: 'Manage product categories',
        action: 'manage',
        resource: 'categories',
        module: PermissionModule.CONTENT_MANAGEMENT,
      },
      {
        category: 'content',
        name: 'manage_banners',
        description: 'Manage banners and promotions',
        action: 'manage',
        resource: 'banners',
        module: PermissionModule.CONTENT_MANAGEMENT,
      },
      {
        category: 'content',
        name: 'manage_blogs',
        description: 'Manage blog posts',
        action: 'manage',
        resource: 'blogs',
        module: PermissionModule.CONTENT_MANAGEMENT,
      },
      {
        category: 'content',
        name: 'manage_reviews',
        description: 'Manage product reviews',
        action: 'manage',
        resource: 'reviews',
        module: PermissionModule.CONTENT_MANAGEMENT,
      },
      {
        category: 'content',
        name: 'manage_faqs',
        description: 'Manage FAQs',
        action: 'manage',
        resource: 'faqs',
        module: PermissionModule.CONTENT_MANAGEMENT,
      },

      // Financial Management
      {
        category: 'financial',
        name: 'view_revenue',
        description: 'View revenue reports',
        action: 'read',
        resource: 'revenue',
        module: PermissionModule.FINANCIAL_MANAGEMENT,
      },
      {
        category: 'financial',
        name: 'process_payouts',
        description: 'Process vendor payouts',
        action: 'update',
        resource: 'payouts',
        module: PermissionModule.FINANCIAL_MANAGEMENT,
      },
      {
        category: 'financial',
        name: 'view_transactions',
        description: 'View transaction history',
        action: 'read',
        resource: 'transactions',
        module: PermissionModule.FINANCIAL_MANAGEMENT,
      },
      {
        category: 'financial',
        name: 'manage_coupons',
        description: 'Manage discount coupons',
        action: 'manage',
        resource: 'coupons',
        module: PermissionModule.FINANCIAL_MANAGEMENT,
      },
      {
        category: 'financial',
        name: 'view_financial_reports',
        description: 'View financial reports',
        action: 'read',
        resource: 'financial_reports',
        module: PermissionModule.FINANCIAL_MANAGEMENT,
      },

      // System Management
      {
        category: 'system',
        name: 'manage_roles',
        description: 'Manage roles and permissions',
        action: 'manage',
        resource: 'roles',
        module: PermissionModule.SYSTEM_MANAGEMENT,
      },
      {
        category: 'system',
        name: 'system_config',
        description: 'Configure system settings',
        action: 'update',
        resource: 'system',
        module: PermissionModule.SYSTEM_MANAGEMENT,
      },
      {
        category: 'system',
        name: 'view_logs',
        description: 'View system logs',
        action: 'read',
        resource: 'logs',
        module: PermissionModule.SYSTEM_MANAGEMENT,
      },
      {
        category: 'system',
        name: 'backup_restore',
        description: 'Backup and restore data',
        action: 'manage',
        resource: 'system',
        module: PermissionModule.SYSTEM_MANAGEMENT,
      },
      {
        category: 'system',
        name: 'api_management',
        description: 'Manage API settings',
        action: 'manage',
        resource: 'api',
        module: PermissionModule.SYSTEM_MANAGEMENT,
      },

      // Support Management
      {
        category: 'support',
        name: 'view_tickets',
        description: 'View support tickets',
        action: 'read',
        resource: 'tickets',
        module: PermissionModule.SUPPORT_MANAGEMENT,
      },
      {
        category: 'support',
        name: 'respond_tickets',
        description: 'Respond to support tickets',
        action: 'update',
        resource: 'tickets',
        module: PermissionModule.SUPPORT_MANAGEMENT,
      },
      {
        category: 'support',
        name: 'resolve_tickets',
        description: 'Resolve support tickets',
        action: 'update',
        resource: 'tickets',
        module: PermissionModule.SUPPORT_MANAGEMENT,
      },
      {
        category: 'support',
        name: 'view_chat',
        description: 'View chat messages',
        action: 'read',
        resource: 'chat',
        module: PermissionModule.SUPPORT_MANAGEMENT,
      },

      // Analytics
      {
        category: 'analytics',
        name: 'view_dashboard',
        description: 'View analytics dashboard',
        action: 'read',
        resource: 'dashboard',
        module: PermissionModule.ANALYTICS,
      },
      {
        category: 'analytics',
        name: 'view_user_analytics',
        description: 'View user analytics',
        action: 'read',
        resource: 'users',
        module: PermissionModule.ANALYTICS,
      },
      {
        category: 'analytics',
        name: 'view_sales_analytics',
        description: 'View sales analytics',
        action: 'read',
        resource: 'sales',
        module: PermissionModule.ANALYTICS,
      },
      {
        category: 'analytics',
        name: 'view_product_analytics',
        description: 'View product analytics',
        action: 'read',
        resource: 'products',
        module: PermissionModule.ANALYTICS,
      },
      {
        category: 'analytics',
        name: 'export_data',
        description: 'Export analytics data',
        action: 'export',
        resource: 'data',
        module: PermissionModule.ANALYTICS,
      },
    ];

    const permissionsMap = new Map<string, PermissionDocument>();

    for (const permissionData of permissionsData) {
      let permission = await this.permissionModel.findOne({
        name: permissionData.name,
      });

      if (!permission) {
        permission = new this.permissionModel(permissionData);
        await permission.save();
        this.logger.log(`Created permission: ${permission.name}`);
      } else {
        this.logger.log(`Permission already exists: ${permission.name}`);
      }

      permissionsMap.set(permission.name, permission);
    }

    this.logger.log(`Seeded ${permissionsMap.size} permissions`);
    return permissionsMap;
  }

  /**
   * Seed roles into the database
   */
  private async seedRoles(
    permissions: Map<string, PermissionDocument>,
  ): Promise<Map<string, RoleDocument>> {
    const rolesData = [
      {
        name: 'super_admin',
        description: 'Full system access with all permissions',
        type: RoleType.PLATFORM,
        level: 1,
        is_default: false,
        is_system: true,
        allowed_user_types: [UserType.PLATFORM],
        permission_names: Array.from(permissions.keys()), // All permissions
      },
      {
        name: 'admin',
        description:
          'Administrative access with most system management permissions',
        type: RoleType.PLATFORM,
        level: 2,
        is_default: false,
        is_system: true,
        allowed_user_types: [UserType.PLATFORM],
        permission_names: [
          'view_users',
          'create_users',
          'edit_users',
          'ban_users',
          'view_vendors',
          'approve_vendors',
          'suspend_vendors',
          'feature_vendors',
          'view_vendor_analytics',
          'view_products',
          'create_products',
          'edit_products',
          'delete_products',
          'approve_products',
          'feature_products',
          'view_orders',
          'edit_orders',
          'cancel_orders',
          'process_refunds',
          'view_sales_reports',
          'manage_categories',
          'manage_banners',
          'manage_blogs',
          'manage_reviews',
          'manage_faqs',
          'view_revenue',
          'process_payouts',
          'view_transactions',
          'manage_coupons',
          'view_financial_reports',
          'view_logs',
          'view_tickets',
          'respond_tickets',
          'resolve_tickets',
          'view_chat',
          'view_dashboard',
          'view_user_analytics',
          'view_sales_analytics',
          'view_product_analytics',
          'export_data',
        ],
      },
      {
        name: 'owner',
        description:
          'Full vendor control — manages all aspects of the business',
        type: RoleType.VENDOR,
        level: 1,
        is_default: true,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: Array.from(permissions.keys()), // Owner has all vendor permissions
      },
      {
        name: 'customer_support',
        description: 'Handles customer inquiries, support tickets, and chat',
        type: RoleType.VENDOR,
        level: 2,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'view_tickets',
          'respond_tickets',
          'resolve_tickets',
          'view_chat',
          'view_orders',
          'process_refunds',
        ],
      },
      {
        name: 'operations',
        description: 'Manages orders, logistics, and fulfillment operations',
        type: RoleType.VENDOR,
        level: 3,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'view_orders',
          'edit_orders',
          'cancel_orders',
          'process_refunds',
          'view_sales_reports',
          'view_financial_reports',
        ],
      },
      {
        name: 'marketing',
        description: 'Responsible for promotions, ads, and marketing analytics',
        type: RoleType.VENDOR,
        level: 4,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'manage_banners',
          'manage_coupons',
          'manage_blogs',
          'feature_products',
          'view_dashboard',
          'view_sales_analytics',
          'export_data',
        ],
      },
      {
        name: 'tailor',
        description: 'Handles tailoring, fitting, and product adjustments',
        type: RoleType.VENDOR,
        level: 5,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'view_orders',
          'update_order_status',
          'view_products',
        ],
      },
      {
        name: 'data_analyst',
        description: 'Monitors reports and analytics for performance insights',
        type: RoleType.VENDOR,
        level: 6,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'view_dashboard',
          'view_vendor_analytics',
          'view_sales_analytics',
          'view_product_analytics',
          'export_data',
        ],
      },
      {
        name: 'sales',
        description: 'Manages sales operations and customer relations',
        type: RoleType.VENDOR,
        level: 7,
        is_system: true,
        allowed_user_types: [UserType.VENDOR],
        permission_names: [
          'view_products',
          'view_orders',
          'create_orders',
          'cancel_orders',
          'manage_reviews',
        ],
      },

      {
        name: 'customer',
        description: 'Customer access for shopping and account management',
        type: RoleType.PLATFORM,
        level: 5,
        is_default: true,
        is_system: true,
        allowed_user_types: [UserType.CUSTOMER],
        permission_names: [
          'view_products',
          'view_orders',
          'create_orders',
          'cancel_orders',
          'manage_reviews',
          'view_transactions',
          'view_tickets',
          'respond_tickets',
        ],
      },

      {
        name: 'moderator',
        description: 'Content moderation and user management',
        type: RoleType.PLATFORM,
        level: 3,
        is_default: false,
        is_system: true,
        allowed_user_types: [UserType.PLATFORM],
        permission_names: [
          'view_users',
          'edit_users',
          'ban_users',
          'view_vendors',
          'approve_vendors',
          'suspend_vendors',
          'view_products',
          'edit_products',
          'approve_products',
          'view_orders',
          'manage_categories',
          'manage_blogs',
          'manage_reviews',
          'manage_faqs',
          'view_logs',
          'view_tickets',
          'respond_tickets',
          'resolve_tickets',
          'view_chat',
          'view_dashboard',
          'view_user_analytics',
          'view_product_analytics',
          'export_data',
        ],
      },
    ];

    const rolesMap = new Map<string, RoleDocument>();

    for (const roleData of rolesData) {
      let role = await this.roleModel.findOne({ name: roleData.name });

      const permissionIds = roleData.permission_names
        .map((name) => permissions.get(name)?._id)
        .filter(Boolean) as Schema.Types.ObjectId[];

      if (!role) {
        role = new this.roleModel({
          name: roleData.name,
          description: roleData.description,
          type: roleData.type,
          level: roleData.level,
          permissions: permissionIds,
          is_default: roleData.is_default,
          is_system: roleData.is_system,
          allowed_user_types: roleData.allowed_user_types,
        });
        await role.save();
        this.logger.log(`Created role: ${role.name}`);
      } else {
        role.permissions = permissionIds;
        await role.save();
        this.logger.log(`Updated role: ${role.name}`);
      }

      rolesMap.set(role.name, role);
    }

    this.logger.log(`Seeded ${rolesMap.size} roles`);
    return rolesMap;
  }

  /**
   * Seed users and businesses into the database
   */
  private async seedUsersAndBusinesses(
    roles: Map<string, RoleDocument>,
  ): Promise<void> {
    const hashed_password = await bcrypt.hash('Password123!', 12);

    // Seed Super Admin (Platform User)
    const superAdminRole = roles.get('super_admin');
    if (superAdminRole) {
      const existingSuperAdmin = await this.userModel.findOne({
        email: 'superadmin@example.com',
      });
      if (!existingSuperAdmin) {
        const superAdmin = new this.userModel({
          email: 'superadmin@example.com',
          hashed_password,
          full_name: 'Super Administrator',
          phone_number: '+1234567890',
          type: UserType.PLATFORM,
          role: superAdminRole._id,
          email_verified: true,
        });
        await superAdmin.save();
        this.logger.log('Created super admin: superadmin@example.com');
      }
    }

    // Seed Admin (Platform User)
    const adminRole = roles.get('admin');
    if (adminRole) {
      const existingAdmin = await this.userModel.findOne({
        email: 'admin@example.com',
      });
      if (!existingAdmin) {
        const admin = new this.userModel({
          email: 'admin@example.com',
          hashed_password,
          full_name: 'System Administrator',
          phone_number: '+1234567891',
          type: UserType.PLATFORM,
          role: adminRole._id,
          email_verified: true,
        });
        await admin.save();
        this.logger.log('Created admin: admin@example.com');
      }
    }

    // Seed Moderator (Platform User)
    const moderatorRole = roles.get('moderator');
    if (moderatorRole) {
      const existingModerator = await this.userModel.findOne({
        email: 'moderator@example.com',
      });
      if (!existingModerator) {
        const moderator = new this.userModel({
          email: 'moderator@example.com',
          hashed_password,
          full_name: 'Content Moderator',
          phone_number: '+1234567894',
          type: UserType.PLATFORM,
          role: moderatorRole._id,
          email_verified: true,
        });
        await moderator.save();
        this.logger.log('Created moderator: moderator@example.com');
      }
    }

    // Seed Customer
    const customerRole = roles.get('customer');
    if (customerRole) {
      const existingCustomer = await this.userModel.findOne({
        email: 'customer@example.com',
      });
      if (!existingCustomer) {
        const customer = new this.userModel({
          email: 'customer@example.com',
          hashed_password,
          full_name: 'John Customer',
          phone_number: '+1234567892',
          type: UserType.CUSTOMER,
          role: customerRole._id,
          email_verified: true,
          dob: new Date('1990-01-01'),
          wears_preference: 'man',
          aesthetic_preferences: ['minimalist', 'vintage'],
          body_fit: ['petite', 'curve'],
          is_email_preference_selected: true,
        });
        await customer.save();
        this.logger.log('Created customer: customer@example.com');
      }

      // Seed another customer
      const existingCustomer2 = await this.userModel.findOne({
        email: 'jane@example.com',
      });
      if (!existingCustomer2) {
        const customer2 = new this.userModel({
          email: 'jane@example.com',
          hashed_password,
          full_name: 'Jane Smith',
          phone_number: '+1234567893',
          type: UserType.CUSTOMER,
          role: customerRole._id,
          email_verified: true,
          dob: new Date('1992-05-15'),
          wears_preference: 'woman',
          aesthetic_preferences: ['elegant', 'classic'],
          body_fit: ['petite', 'curve'],
          is_email_preference_selected: false,
        });
        await customer2.save();
        this.logger.log('Created customer: jane@example.com');
      }
    }

    // Seed Vendor and Business
    const vendorRole = roles.get('vendor');
    if (vendorRole) {
      const existingVendor = await this.userModel.findOne({
        email: 'vendor@example.com',
      });
      if (!existingVendor) {
        // Create Vendor User
        const vendorUser = new this.userModel({
          email: 'vendor@example.com',
          hashed_password,
          full_name: 'Jane Vendor',
          phone_number: '+1234567895',
          type: UserType.VENDOR,
          role: vendorRole._id,
          email_verified: true,
        });
        await vendorUser.save();
        this.logger.log('Created vendor user: vendor@example.com');

        // Create Business for the Vendor
        const business = new this.businessModel({
          business_name: 'Fashion Store Inc',
          business_email: 'business@fashionstore.com',
          business_phone_number: '+1234567896',
          business_address: '123 Business Street, New York, NY 10001',
          personalName: 'Jane Vendor',
          display_picture_url: 'https://example.com/vendor.jpg',
          business_logo_url: 'https://example.com/logo.jpg',
          cover_image_url: 'https://example.com/cover.jpg',
          vendor: vendorUser._id,
          description: 'We sell fashionable clothing for all ages',
          country: 'US',
          city: 'New York',
          state: 'NY',
          zip_code: '10001',
          year_founded: '2020',
          website: 'https://fashionstore.com',
        });
        await business.save();
        this.logger.log('Created business for vendor');

        await vendorUser.save();
        this.logger.log('Updated vendor user with business reference');
      }

      // Seed another vendor
      const existingVendor2 = await this.userModel.findOne({
        email: 'techgadgets@example.com',
      });
      if (!existingVendor2) {
        const vendorUser2 = new this.userModel({
          email: 'techgadgets@example.com',
          hashed_password,
          full_name: 'Mike Tech',
          phone_number: '+1234567897',
          type: UserType.VENDOR,
          role: vendorRole._id,
          email_verified: true,
        });
        await vendorUser2.save();
        this.logger.log('Created vendor user: techgadgets@example.com');

        const business2 = new this.businessModel({
          business_name: 'Tech Gadgets Store',
          business_email: 'business@techgadgets.com',
          business_phone_number: '+1234567898',
          business_address: '456 Tech Avenue, San Francisco, CA 94102',
          personalName: 'Mike Tech',
          display_picture_url: 'https://example.com/techvendor.jpg',
          business_logo_url: 'https://example.com/techlogo.jpg',
          cover_image_url: 'https://example.com/techcover.jpg',
          vendor: vendorUser2._id,
          description: 'Latest tech gadgets and electronics',
          country: 'US',
          city: 'San Francisco',
          state: 'CA',
          zip_code: '94102',
          year_founded: '2018',
          website: 'https://techgadgets.com',
        });
        await business2.save();
        this.logger.log('Created business for second vendor');

        await vendorUser2.save();
        this.logger.log('Updated second vendor user with business reference');
      }
    }

    this.logger.log('User and business seeding completed');
  }

  /**
   * Get seed data summary
   */
  async getSeedSummary(): Promise<{
    permissions: number;
    roles: number;
    users: number;
    businesses: number;
  }> {
    const permissionCount = await this.permissionModel.countDocuments();
    const roleCount = await this.roleModel.countDocuments();
    const userCount = await this.userModel.countDocuments();
    const businessCount = await this.businessModel.countDocuments();

    return {
      permissions: permissionCount,
      roles: roleCount,
      users: userCount,
      businesses: businessCount,
    };
  }
}
