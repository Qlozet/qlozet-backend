/**
 * Store addresses: shop.qlozet.app/s/<slug>.
 *
 * A store gets a slug made from its name when it is created, and the vendor
 * can change it in settings. Old slugs are kept in `previous_slugs` so links
 * a vendor already shared keep working (the shop redirects them to the
 * current one), and nobody else can claim them while they are kept.
 *
 * The old /vendor/<id> links keep working too; slugs are never 24-hex so the
 * two can't be confused.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/** How many old slugs a store keeps redirecting. The oldest drops off. */
export const PREVIOUS_SLUGS_KEPT = 5;

/**
 * Names a store may not take: anything that reads as Qlozet itself or as
 * staff, and a few words that would be confusing as a store address.
 */
const RESERVED = new Set([
  'qlozet', 'qlozetapp', 'qlozet-app', 'qlozet-official', 'qlozet-support',
  'admin', 'administrator', 'staff', 'team', 'support', 'help', 'helpdesk',
  'official', 'moderator', 'security', 'billing', 'payments', 'payment',
  'api', 'www', 'app', 'apps', 'mail', 'email', 'root', 'system',
  'shop', 'store', 'stores', 'vendor', 'vendors', 'seller', 'sellers',
  'login', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'logout',
  'account', 'settings', 'profile', 'cart', 'checkout', 'orders',
  'search', 'discover', 'trending', 'new', 'null', 'undefined', 'test',
]);

const FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OBJECT_ID = /^[0-9a-f]{24}$/;

/** Lower-case, trimmed form a vendor's typed address is compared in. */
export function normalizeSlug(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

/** Why a slug can't be used, in words a vendor can act on; null when it can. */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_MIN) {
    return `Use at least ${SLUG_MIN} characters.`;
  }
  if (slug.length > SLUG_MAX) {
    return `Use ${SLUG_MAX} characters or fewer.`;
  }
  if (!FORMAT.test(slug)) {
    return 'Use only lowercase letters, numbers and single hyphens, with no hyphen at the start or end.';
  }
  if (OBJECT_ID.test(slug)) {
    return 'Choose an address with a word in it.';
  }
  if (RESERVED.has(slug) || slug.startsWith('qlozet')) {
    return 'That address is reserved. Try one with your store name.';
  }
  return null;
}

/**
 * A slug made from a store name: "Adaeze Couture & Co." → "adaeze-couture-and-co".
 * Always returns something usable (falls back to "store") so a name made only
 * of emoji or symbols still gets an address.
 */
export function slugFromName(name: unknown): string {
  let s = typeof name === 'string' ? name : '';
  s = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents: é → e
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '') // "Ada's" → "adas", not "ada-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (s.length > SLUG_MAX) {
    s = s.slice(0, SLUG_MAX);
    // Cut at a word boundary when there is one in the back half.
    const cut = s.lastIndexOf('-');
    if (cut >= SLUG_MAX / 2) s = s.slice(0, cut);
    s = s.replace(/-+$/g, '');
  }

  if (s.length < SLUG_MIN) s = s ? `${s}-store` : 'store';
  // A name that lands on a reserved word gets a suffix rather than failing.
  if (slugProblem(s)) s = `${s.slice(0, SLUG_MAX - 6)}-store`.replace(/^-+/, '');
  if (slugProblem(s)) s = 'my-store';
  return s;
}

/**
 * The first free slug for a name: the plain slug, then -2, -3 … and finally a
 * random suffix. `taken` says whether any store already uses (or keeps) a slug.
 */
export async function freeSlugFor(
  name: unknown,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugFromName(name);
  if (!(await taken(base))) return base;

  for (let n = 2; n <= 30; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }

  return randomSlugFor(name, taken);
}

/** The store name's slug plus a random ending, e.g. "ada-couture-k3x9q". */
export async function randomSlugFor(
  name: unknown,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugFromName(name);
  for (let i = 0; i < 10; i++) {
    const suffix = `-${Math.random().toString(36).slice(2, 7)}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!slugProblem(candidate) && !(await taken(candidate))) return candidate;
  }
  throw new Error(`No free store address for "${String(name)}"`);
}

/** Mongo filter for "a store that uses or keeps this slug". */
export function slugOwnerFilter(slug: string) {
  return { $or: [{ slug }, { previous_slugs: slug }] };
}

/** The bit of a Mongo collection (native or Mongoose model.collection) used here. */
export interface SlugCollection {
  findOne(filter: any, options?: any): Promise<any>;
  updateOne(filter: any, update: any): Promise<any>;
}

/**
 * Give a store an address if it has none. Safe to call more than once and to
 * race: the unique index rejects a duplicate, and it simply tries again.
 * Returns the store's slug (existing or new).
 */
export async function ensureStoreSlug(
  collection: SlugCollection,
  business: { _id: any; business_name?: string; slug?: string | null },
): Promise<string> {
  if (business.slug) return business.slug;

  const taken = async (slug: string) =>
    !!(await collection.findOne(slugOwnerFilter(slug), {
      projection: { _id: 1 },
    }));

  // Stores signing up with the same name at the same moment all pick the
  // same "next free" address and collide again on every round, so after two
  // collisions switch to a random ending, which racing sign-ups can't share.
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug =
      attempt < 2
        ? await freeSlugFor(business.business_name, taken)
        : await randomSlugFor(business.business_name, taken);
    try {
      const res = await collection.updateOne(
        { _id: business._id, $or: [{ slug: { $exists: false } }, { slug: null }] },
        { $set: { slug } },
      );
      if (res?.matchedCount === 0) {
        // Someone gave it an address in the meantime: use that one.
        const current = await collection.findOne(
          { _id: business._id },
          { projection: { slug: 1 } },
        );
        if (current?.slug) return current.slug;
      }
      return slug;
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // only retry a duplicate address
    }
  }
  throw new Error(`Could not give store ${String(business._id)} an address`);
}
