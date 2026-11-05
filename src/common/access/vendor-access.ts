/**
 * What each vendor team role may do, as areas of the vendor app.
 *
 * The routes already enforce this through @VendorRoles(); this is the same
 * matrix written down once, so the vendor app can hide what a member cannot
 * use and the assistant can refuse to carry out an action for a member who
 * could not do it directly. The owner may do everything; '*' means every
 * member. Keep in step with the @VendorRoles() lists when either changes.
 */
import { VendorRole } from '../../modules/ums/schemas/role.schema';

const ALL = '*' as const;
type Grant = readonly (VendorRole | typeof ALL)[];

export const VENDOR_AREAS = {
  // Orders
  'orders.fulfil': [VendorRole.OPERATIONS, VendorRole.CUSTOMER_SUPPORT],
  'orders.reject': [VendorRole.OPERATIONS],
  'orders.production': [ALL],
  'returns.manage': [VendorRole.OPERATIONS],
  'disputes.respond': [VendorRole.OPERATIONS],
  // Catalogue
  'products.manage': [VendorRole.OPERATIONS, VendorRole.SALES],
  'products.status': [VendorRole.OPERATIONS, VendorRole.SALES],
  'products.schedule': [VendorRole.OPERATIONS],
  'discounts.manage': [VendorRole.MARKETING, VendorRole.SALES],
  'collections.manage': [VendorRole.MARKETING],
  'size_guides.manage': [VendorRole.OPERATIONS, VendorRole.TAILOR],
  'styles.manage': [VendorRole.OPERATIONS, VendorRole.TAILOR],
  // Money
  'money.view': [
    VendorRole.OPERATIONS,
    VendorRole.DATA_ANALYST,
    VendorRole.SALES,
  ],
  'wallet.fund': [VendorRole.OPERATIONS],
  'wallet.withdraw': [VendorRole.OPERATIONS],
  'payout_account.manage': [],
  'tokens.purchase': [],
  // The business
  'team.manage': [],
  'store.profile': [],
  verification: [],
  // Everyone
  tickets: [ALL],
  'customers.view': [ALL],
  'assistant.chat': [ALL],
} as const satisfies Record<string, Grant>;

export type VendorArea = keyof typeof VENDOR_AREAS;

export const VENDOR_AREA_LIST = Object.keys(VENDOR_AREAS) as VendorArea[];

const normalise = (role: string | null | undefined): string =>
  (role ?? '').trim().toLowerCase();

export const isVendorOwner = (
  roleName: string | null | undefined,
  isOwnerFlag?: boolean | null,
): boolean => Boolean(isOwnerFlag) || normalise(roleName) === VendorRole.OWNER;

export const vendorAreaAllows = (
  area: VendorArea,
  roleName: string | null | undefined,
  isOwnerFlag?: boolean | null,
): boolean => {
  if (isVendorOwner(roleName, isOwnerFlag)) return true;
  const grant: Grant = VENDOR_AREAS[area];
  if (grant.includes(ALL)) return true;
  return grant.includes(normalise(roleName) as VendorRole);
};

/** Every area this member may use, for the access read. */
export const vendorAreasFor = (
  roleName: string | null | undefined,
  isOwnerFlag?: boolean | null,
): VendorArea[] =>
  VENDOR_AREA_LIST.filter((area) =>
    vendorAreaAllows(area, roleName, isOwnerFlag),
  );

/**
 * The @VendorRoles() list for an area, owner included, so a route takes its
 * roles from this table and can't drift from what the vendor app shows.
 * Usage: @VendorRoles(...vendorRolesFor('discounts.manage')).
 */
export const vendorRolesFor = (area: VendorArea): VendorRole[] => {
  const grant: Grant = VENDOR_AREAS[area];
  if (grant.includes(ALL)) {
    throw new Error(`${area} is open to every member; use no @VendorRoles`);
  }
  return [VendorRole.OWNER, ...(grant as VendorRole[])];
};

/** Keys that carry the store's money on shared dashboards. */
const MONEY_KEYS = new Set([
  'gross_sales',
  'totalEarnings',
  'totalEarningsChange',
  'revenue',
  'total_revenue',
]);

/**
 * Dashboards every member opens (home, catalogue) also carry sales figures.
 * A member without money.view gets the same response with those figures as
 * null, rather than a refused page.
 */
export const hideMoneyUnlessAllowed = <T>(
  body: T,
  roleName: string | null | undefined,
  isOwnerFlag?: boolean | null,
): T => {
  if (vendorAreaAllows('money.view', roleName, isOwnerFlag)) return body;
  const strip = (v: any): any => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object' && !(v instanceof Date) && !v._bsontype) {
      const out: Record<string, any> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = MONEY_KEYS.has(k) ? null : strip(val);
      }
      return out;
    }
    return v;
  };
  return strip(body);
};

/** The area each assistant action stands in for; the confirm step checks it. */
export const ASSISTANT_ACTION_AREA: Record<string, VendorArea> = {
  confirm_order: 'orders.fulfil',
  reply_to_quote: 'orders.fulfil',
  update_stock: 'products.manage',
  create_discount: 'discounts.manage',
  update_listing: 'products.manage',
};

const AREA_LABEL: Partial<Record<VendorArea, string>> = {
  'orders.fulfil': 'confirm or fulfil orders',
  'orders.reject': 'reject or cancel orders',
  'products.manage': 'change listings or stock',
  'discounts.manage': 'manage discounts',
  'collections.manage': 'manage collections',
  'money.view': 'see the shop’s money',
  'wallet.withdraw': 'withdraw from the wallet',
};

/** "Only the owner or operations can confirm or fulfil orders." */
export const vendorAreaDeniedMessage = (area: VendorArea): string => {
  const grant: Grant = VENDOR_AREAS[area];
  const who = [
    'the owner',
    ...grant.filter((r) => r !== ALL).map((r) => String(r).replace(/_/g, ' ')),
  ];
  const list =
    who.length <= 1
      ? who[0]
      : `${who.slice(0, -1).join(', ')} or ${who[who.length - 1]}`;
  return `Only ${list} can ${AREA_LABEL[area] ?? `use ${area}`}.`;
};
