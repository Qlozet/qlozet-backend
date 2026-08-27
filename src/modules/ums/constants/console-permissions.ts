import { PermissionModule } from '../schemas/permission.schema';

/**
 * The permission matrix the admin console's "Edit Access" screen renders.
 *
 * The legacy catalogue seeded by SeedService is a flat list of hand-named
 * permissions (`view_users`, `approve_vendors`, …) that covers a read action
 * for most areas and little else — there is no `create_vendors`, no
 * `delete_orders`. The console grants access as a module × action grid, so the
 * grid needs a permission document per cell; these are those cells.
 *
 * Names are `resource.action`, which cannot collide with the legacy
 * `action_resource` names, so both sets live in the same collection and a role
 * can hold either.
 */

export const CONSOLE_ACTIONS = ['view', 'create', 'edit', 'delete'] as const;

export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

export interface ConsoleResource {
  /** Stable key — also the permission's `resource` and the UI's row key. */
  key: string;
  /** Row label, exactly as the console shows it. */
  label: string;
  /** Which of the schema's coarse modules this row belongs to. */
  module: PermissionModule;
}

export const CONSOLE_RESOURCES: ConsoleResource[] = [
  {
    key: 'dashboard',
    label: 'Dashboard (read only)',
    module: PermissionModule.ANALYTICS,
  },
  {
    key: 'vendors',
    label: 'Vendors',
    module: PermissionModule.VENDOR_MANAGEMENT,
  },
  {
    key: 'customers',
    label: 'Customers',
    module: PermissionModule.USER_MANAGEMENT,
  },
  { key: 'orders', label: 'Orders', module: PermissionModule.ORDER_MANAGEMENT },
  {
    key: 'products',
    label: 'Products',
    module: PermissionModule.PRODUCT_MANAGEMENT,
  },
  {
    key: 'tickets',
    label: 'Tickets & Complaints',
    module: PermissionModule.SUPPORT_MANAGEMENT,
  },
  {
    key: 'payments',
    label: 'Payments & Payouts',
    module: PermissionModule.FINANCIAL_MANAGEMENT,
  },
  {
    key: 'marketing',
    label: 'Marketing (Coupons, Banners)',
    module: PermissionModule.CONTENT_MANAGEMENT,
  },
  {
    key: 'blogs',
    label: 'Blogs / Static Pages',
    module: PermissionModule.CONTENT_MANAGEMENT,
  },
  {
    key: 'admin-management',
    label: 'Admin Management',
    module: PermissionModule.SYSTEM_MANAGEMENT,
  },
  {
    key: 'performance',
    label: 'Performance Analytics',
    module: PermissionModule.ANALYTICS,
  },
  {
    key: 'announcements',
    label: 'Announcements',
    module: PermissionModule.CONTENT_MANAGEMENT,
  },
  {
    key: 'notifications',
    label: 'Notifications (Push & Emails)',
    module: PermissionModule.CONTENT_MANAGEMENT,
  },
  {
    key: 'live-chat',
    label: 'Live chat Logs',
    module: PermissionModule.SUPPORT_MANAGEMENT,
  },
  {
    key: 'settings',
    label: 'Settings (Shipping, Tax, General)',
    module: PermissionModule.SYSTEM_MANAGEMENT,
  },
];

export const consolePermissionName = (
  resourceKey: string,
  action: ConsoleAction,
): string => `${resourceKey}.${action}`;

const ACTION_VERB: Record<ConsoleAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
};

/** Every cell of the grid, ready to be inserted as a Permission document. */
export const consolePermissionSeeds = () =>
  CONSOLE_RESOURCES.flatMap((resource) =>
    CONSOLE_ACTIONS.map((action) => ({
      category: resource.key,
      name: consolePermissionName(resource.key, action),
      description: `${ACTION_VERB[action]} — ${resource.label}`,
      action,
      resource: resource.key,
      module: resource.module,
    })),
  );

/**
 * The platform staff roles the console offers when adding an admin.
 *
 * `super_admin` and `admin` are seeded by SeedService already; these are the
 * rest of the roles in the design's role picker. Level orders them in the
 * grid — lower is more senior.
 */
export const CONSOLE_PLATFORM_ROLES = [
  {
    name: 'customer_support',
    description: 'Handles customer enquiries, support tickets and live chat.',
    level: 3,
    resources: ['dashboard', 'customers', 'orders', 'tickets', 'live-chat'],
  },
  {
    name: 'operations',
    description:
      'Runs day-to-day operations across orders, vendors and products.',
    level: 3,
    resources: [
      'dashboard',
      'vendors',
      'customers',
      'orders',
      'products',
      'tickets',
    ],
  },
  {
    name: 'marketing',
    description: 'Owns campaigns, coupons, banners, blogs and announcements.',
    level: 4,
    resources: [
      'dashboard',
      'marketing',
      'blogs',
      'announcements',
      'notifications',
    ],
  },
  {
    name: 'data_analyst',
    description:
      'Reads reporting and performance analytics across the platform.',
    level: 4,
    resources: ['dashboard', 'performance'],
  },
  {
    name: 'sales',
    description:
      'Works vendor and customer accounts and the orders they place.',
    level: 4,
    resources: ['dashboard', 'vendors', 'customers', 'orders'],
  },
] as const;
