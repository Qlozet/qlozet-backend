/**
 * What the admin console's permission grid means on the wire.
 *
 * A role's grant is a set of `<resource>.<action>` names (see
 * ums/constants/console-permissions.ts). This file maps an HTTP request to
 * the one cell it needs, so the ConsoleAccessGuard can enforce the grid
 * without every controller declaring permissions by hand. Pure, so it is
 * tested on its own.
 */
import {
  CONSOLE_RESOURCES,
  consolePermissionName,
  type ConsoleAction,
} from '../../modules/ums/constants/console-permissions';

export interface ConsoleCell {
  resource: string;
  action: ConsoleAction;
}

/** Roles that see the whole console. Everything else goes through the grid. */
export const FULL_ACCESS_ROLES = new Set(['super_admin', 'admin']);

/** Only the owner-level role may do these (deleting an administrator). */
export const SUPER_ADMIN_ONLY = new Set(['super_admin']);

const METHOD_ACTION: Record<string, ConsoleAction> = {
  GET: 'view',
  HEAD: 'view',
  POST: 'create',
  PUT: 'edit',
  PATCH: 'edit',
  DELETE: 'delete',
};

interface Rule {
  test: RegExp;
  resource: string;
  /** Fixed action, where the verb is not what the method says (approve = edit). */
  action?: ConsoleAction;
  /** Only these methods; others fall through to later rules. */
  methods?: string[];
}

/**
 * First match wins, so the specific rows sit above the broad ones. Paths are
 * matched after the global prefix is stripped and without the query string.
 */
const RULES: Rule[] = [
  // ── The console's own routes (platform controller) ──
  { test: /^\/admin\/dashboard(\/|$)/, resource: 'dashboard' },
  { test: /^\/admin\/me\/overview$/, resource: 'dashboard' },
  { test: /^\/admin\/businesses\/[^/]+\/(wallet|transactions)$/, resource: 'payments' },
  { test: /^\/admin\/businesses\/[^/]+\/escalate$/, resource: 'tickets', action: 'create' },
  { test: /^\/admin\/(businesses|vendor-notes|vendor\/dashboard)(\/|$)/, resource: 'vendors' },
  { test: /^\/admin\/[^/]+\/(approve|verify|reject|verification-decision|in-review)$/, resource: 'vendors', action: 'edit' },
  { test: /^\/admin\/customer\/[^/]+\/transactions$/, resource: 'payments' },
  { test: /^\/admin\/customer(\/|$)/, resource: 'customers' },
  { test: /^\/admin\/vendor\/orders(\/|$)/, resource: 'orders' },
  { test: /^\/admin\/(products|bespoke)(\/|$)/, resource: 'products' },
  { test: /^\/admin\/[^/]+\/(assign|reply)$/, resource: 'tickets', action: 'edit' },
  { test: /^\/admin\/settings(\/|$)/, resource: 'settings' },
  // Anything else under /admin: reading is dashboard-level, writing is settings-level.
  { test: /^\/admin(\/|$)/, resource: 'dashboard', methods: ['GET', 'HEAD'] },
  { test: /^\/admin(\/|$)/, resource: 'settings' },

  // ── Shared controllers the console also uses ──
  { test: /^\/users\/(admins|permissions|roles)(\/|$)/, resource: 'admin-management' },
  { test: /^\/users\/platform-settings$/, resource: 'settings', action: 'edit', methods: ['PUT', 'PATCH'] },
  { test: /^\/users\/vendors(\/|$)/, resource: 'vendors' },
  { test: /^\/(products|collections|discounts|style-library|taxonomy|size-guides?)(\/|$)/, resource: 'products' },
  { test: /^\/(orders|returns|disputes)(\/|$)/, resource: 'orders' },
  { test: /^\/tickets?(\/|$)/, resource: 'tickets' },
  { test: /^\/help\/admin(\/|$)/, resource: 'blogs' },
  { test: /^\/(transactions|wallets)(\/|$)/, resource: 'payments' },
  { test: /^\/business\/earnings\/backfill/, resource: 'payments', action: 'edit' },
  { test: /^\/notifications\/broadcasts(\/|$)/, resource: 'notifications' },
  { test: /^\/recommendations\/catalog(\/|$)/, resource: 'settings' },
  { test: /^\/assistant(\/|$)/, resource: 'dashboard' },
];

/** Strip the global prefix and the query string: "/api/admin/x?y" → "/admin/x". */
export const normalisePath = (url: string): string => {
  const path = (url || '').split('?')[0].replace(/\/+$/, '') || '/';
  return path.replace(/^\/api(?=\/|$)/, '') || '/';
};

/** The grid cell a request needs, or null when the grid has nothing to say. */
export const resolveConsoleCell = (
  method: string,
  path: string,
): ConsoleCell | null => {
  const verb = (method || 'GET').toUpperCase();
  const action = METHOD_ACTION[verb];
  if (!action) return null;
  for (const rule of RULES) {
    if (rule.methods && !rule.methods.includes(verb)) continue;
    if (rule.test.test(path)) {
      return { resource: rule.resource, action: rule.action ?? action };
    }
  }
  return null;
};

/** Routes that exist only for Qlozet staff; a customer or vendor token is refused. */
export const isConsoleOnlyPath = (path: string): boolean =>
  /^\/admin(\/|$)/.test(path) || /^\/users\/(admins|permissions)(\/|$)/.test(path);

/** What an admin may still call while they owe a password change. */
export const passwordChangeAllowed = (path: string): boolean =>
  /^\/auth\/(change-password|logout|refresh)/.test(path) ||
  /^\/users\/me(\/access)?$/.test(path);

const RESOURCE_LABEL: Record<string, string> = Object.fromEntries(
  CONSOLE_RESOURCES.map((r) => [r.key, r.label.replace(/\s*\(.*\)$/, '')]),
);

const ACTION_VERB: Record<ConsoleAction, string> = {
  view: 'view',
  create: 'add to',
  edit: 'change',
  delete: 'delete from',
};

/** "Your role cannot change Vendors." */
export const deniedMessage = (roleName: string, cell: ConsoleCell): string => {
  const role = roleName.replace(/_/g, ' ');
  return `Your role (${role}) cannot ${ACTION_VERB[cell.action]} ${
    RESOURCE_LABEL[cell.resource] ?? cell.resource
  }.`;
};

/** Every grid permission name, for a role that sees the whole console. */
export const allConsolePermissionNames = (): string[] =>
  CONSOLE_RESOURCES.flatMap((r) =>
    (['view', 'create', 'edit', 'delete'] as ConsoleAction[]).map((a) =>
      consolePermissionName(r.key, a),
    ),
  );

export const permits = (
  permissionNames: Iterable<string>,
  cell: ConsoleCell,
): boolean =>
  new Set(permissionNames).has(consolePermissionName(cell.resource, cell.action));
