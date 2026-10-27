/**
 * Pure pieces of the vendor actions: matching names the model typed to the
 * vendor's real records, and shaping the discount the platform understands.
 * No database here, so it is all unit-testable with plain objects.
 */

import { sanitizeDescription } from '../../../common/utils/description-html';

export const productName = (p: any): string =>
  p?.clothing?.name || p?.fabric?.name || p?.accessory?.name || 'Unnamed product';

export const naira = (n: number) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const norm = (s: any) => String(s ?? '').trim().toLowerCase();

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pick one record by a typed name: an exact (case-insensitive) match wins;
 * one partial match is accepted; anything else is ambiguous and the caller
 * must ask rather than guess.
 */
export function pickByName<T>(
  candidates: T[],
  typed: string,
  nameOf: (c: T) => string,
): { match: T } | { ambiguous: string[] } | { none: true } {
  const want = norm(typed);
  if (!want || !candidates.length) return { none: true };
  const exact = candidates.filter((c) => norm(nameOf(c)) === want);
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { ambiguous: exact.map(nameOf) };
  const partial = candidates.filter((c) => norm(nameOf(c)).includes(want));
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length > 1) return { ambiguous: partial.map(nameOf) };
  return { none: true };
}

export interface StockTarget {
  kind: 'clothing' | 'accessory' | 'fabric';
  /** Clothing: colour variant name. Accessory: variant colour name. */
  color?: string;
  size?: string;
  current: number;
}

/**
 * Resolve "the black one in XL" to one stock cell on a product. Returns an
 * error string when the product has several and the request did not say
 * which, listing the options so the assistant can ask.
 */
export function resolveStockTarget(
  product: any,
  color?: string,
  size?: string,
): { target: StockTarget } | { error: string } {
  const name = productName(product);
  if (product?.kind === 'fabric') {
    return { target: { kind: 'fabric', current: Number(product?.fabric?.yard_length) || 0 } };
  }

  if (product?.kind === 'clothing') {
    const cvs: any[] = product?.clothing?.color_variants || [];
    if (!cvs.length) return { error: `"${name}" has no colour/size variants to set stock on.` };
    let cv: any;
    if (color) {
      const pick = pickByName(cvs, color, (c) => c?.name ?? '');
      if ('match' in pick) cv = pick.match;
      else return { error: `"${name}" has no colour "${color}". Colours: ${cvs.map((c) => c?.name).filter(Boolean).join(', ')}.` };
    } else if (cvs.length === 1) cv = cvs[0];
    else return { error: `"${name}" comes in ${cvs.length} colours (${cvs.map((c) => c?.name).filter(Boolean).join(', ')}). Which one?` };

    const vs: any[] = cv?.variants || [];
    if (!vs.length) return { error: `"${name}" in ${cv?.name} has no sizes to set stock on.` };
    let v: any;
    if (size) {
      v = vs.find((x) => norm(x?.size) === norm(size));
      if (!v) return { error: `"${name}" in ${cv?.name} has no size "${size}". Sizes: ${vs.map((x) => x?.size).filter(Boolean).join(', ')}.` };
    } else if (vs.length === 1) v = vs[0];
    else return { error: `"${name}" in ${cv?.name} has ${vs.length} sizes (${vs.map((x) => x?.size).filter(Boolean).join(', ')}). Which size?` };

    return { target: { kind: 'clothing', color: cv?.name, size: v?.size, current: Number(v?.stock) || 0 } };
  }

  if (product?.kind === 'accessory') {
    const vs: any[] = product?.accessory?.variants || [];
    if (!vs.length) return { error: `"${name}" has no variants to set stock on.` };
    let pool = vs;
    if (color) {
      pool = pool.filter((x) => norm(x?.color?.name) === norm(color));
      if (!pool.length) return { error: `"${name}" has no colour "${color}". Colours: ${[...new Set(vs.map((x) => x?.color?.name).filter(Boolean))].join(', ')}.` };
    }
    if (size) {
      pool = pool.filter((x) => norm(x?.size) === norm(size));
      if (!pool.length) return { error: `"${name}" has no size "${size}". Sizes: ${[...new Set(vs.map((x) => x?.size).filter(Boolean))].join(', ')}.` };
    }
    if (pool.length !== 1) {
      const options = pool.map((x) => [x?.color?.name, x?.size].filter(Boolean).join(' / ')).join(', ');
      return { error: `"${name}" has ${pool.length} matching variants (${options}). Which one?` };
    }
    const v = pool[0];
    return { target: { kind: 'accessory', color: v?.color?.name, size: v?.size, current: Number(v?.stock) || 0 } };
  }

  return { error: `"${name}" is a kind of product stock cannot be set on.` };
}

export interface DiscountRequest {
  title: string;
  value: number;
  value_type: 'percentage' | 'fixed';
  applies_to: 'all' | 'clothing' | 'fabric' | 'accessory' | 'products';
  product_ids?: string[];
  start_date?: Date | null;
  end_date?: Date | null;
}

/**
 * The CreateDiscountDto the discount service expects, from a plain request.
 * Mirrors how the matcher works: store_wide matches everything, a kind scope
 * is a condition on `kind`, a product list is manual_includes, and a dated
 * discount is a flash type - which has no implicit "everything" rule, so a
 * dated store-wide discount gets a condition every active product satisfies.
 */
export function buildDiscountDto(req: DiscountRequest): Record<string, any> {
  const dated = !!(req.start_date || req.end_date);
  const pct = req.value_type === 'percentage';
  let type: string;
  let conditions: { field: string; operator: string; value: string }[] = [];
  let manual_includes: string[] | undefined;

  if (req.applies_to === 'products') {
    type = dated ? (pct ? 'flash_percentage' : 'flash_fixed') : pct ? 'percentage' : 'fixed';
    manual_includes = req.product_ids ?? [];
  } else if (req.applies_to === 'all') {
    type = dated ? (pct ? 'flash_percentage' : 'flash_fixed') : 'store_wide';
    if (dated) conditions = [{ field: 'status', operator: 'is_equal_to', value: 'active' }];
  } else {
    type = dated ? (pct ? 'flash_percentage' : 'flash_fixed') : 'category_specific';
    conditions = [{ field: 'kind', operator: 'is_equal_to', value: req.applies_to }];
  }

  return {
    title: req.title,
    type,
    value: req.value,
    value_type: req.value_type,
    required_discount: false,
    condition_match: 'all',
    conditions,
    is_active: true,
    ...(req.start_date ? { start_date: req.start_date } : {}),
    ...(req.end_date ? { end_date: req.end_date } : {}),
    ...(manual_includes ? { manual_includes } : {}),
  };
}

export function describeDiscount(req: DiscountRequest, affected: number): string {
  const amount = req.value_type === 'percentage' ? `${req.value}% off` : `${naira(req.value)} off`;
  const scope =
    req.applies_to === 'all' ? 'everything in the store'
    : req.applies_to === 'products' ? `${affected} selected product${affected === 1 ? '' : 's'}`
    : `all ${req.applies_to} (${affected} product${affected === 1 ? '' : 's'})`;
  const when =
    req.start_date && req.end_date ? ` from ${req.start_date.toDateString()} to ${req.end_date.toDateString()}`
    : req.end_date ? ` until ${req.end_date.toDateString()}`
    : req.start_date ? ` from ${req.start_date.toDateString()}`
    : '';
  return `${amount} ${scope}${when}.`;
}

// ── Listing changes ───────────────────────────────────────────────────────

export const AUDIENCES = ['men', 'women', 'unisex', 'kids'] as const;
const DESCRIPTION_MIN = 40;
const DESCRIPTION_MAX = 1500;

export interface ListingVocabulary {
  /** Product types valid for this kind; null when the taxonomy has none. */
  product_types: string[] | null;
  /** Allowed categories/attributes for the product's product type; null when unknown. */
  categories: string[] | null;
  attributes: string[] | null;
}

export interface ListingChangeInput {
  description?: unknown;
  audience?: unknown;
  product_type?: unknown;
  categories?: unknown;
  attributes?: unknown;
}

/** Match typed values to a vocabulary, case-insensitively; report what did not match. */
function pickFromVocabulary(
  typed: string[],
  allowed: string[] | null,
): { picked: string[]; unknown: string[] } {
  if (!allowed) return { picked: typed, unknown: [] };
  const byLower = new Map(allowed.map((a) => [norm(a), a]));
  const picked: string[] = [];
  const unknown: string[] = [];
  for (const t of typed) {
    const hit = byLower.get(norm(t));
    if (hit) { if (!picked.includes(hit)) picked.push(hit); }
    else unknown.push(t);
  }
  return { picked, unknown };
}

const asStrings = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : null;

/**
 * Turn a drafted listing change into the exact $set the product needs, or an
 * error the assistant can ask about. Taxonomy values must come from the
 * platform's vocabulary when one exists: search and the stylist filter on
 * these exact strings, so a near-miss is a product nobody finds.
 */
export function validateListingChange(
  product: any,
  input: ListingChangeInput,
  vocab: ListingVocabulary,
): { set: Record<string, any>; details: { label: string; value: string }[]; changed: string[] } | { error: string } {
  const kind = product?.kind;
  if (!['clothing', 'fabric', 'accessory'].includes(kind)) return { error: 'This product kind cannot be edited here.' };
  const sub = product?.[kind] ?? {};
  const tax = sub.taxonomy ?? {};
  const set: Record<string, any> = {};
  const details: { label: string; value: string }[] = [];
  const changed: string[] = [];
  const show = (xs: string[] | undefined | null) => (xs && xs.length ? xs.join(', ') : 'none');

  if (input.description !== undefined) {
    const text = String(input.description ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < DESCRIPTION_MIN) return { error: `The description is too short (${text.length} characters; at least ${DESCRIPTION_MIN}).` };
    if (text.length > DESCRIPTION_MAX) return { error: `The description is too long (${text.length} characters; at most ${DESCRIPTION_MAX}).` };
    if (/https?:\/\/|www\./i.test(text)) return { error: 'Descriptions cannot contain links.' };
    // Stored as clean HTML, the way the shop shows descriptions.
    set[`${kind}.description`] = sanitizeDescription(text);
    details.push({ label: 'Description', value: text.length > 220 ? `${text.slice(0, 220)}…` : text });
    changed.push('description');
  }

  if (input.audience !== undefined) {
    const a = norm(input.audience);
    if (!(AUDIENCES as readonly string[]).includes(a)) return { error: `audience must be one of ${AUDIENCES.join(', ')}.` };
    set[`${kind}.taxonomy.audience`] = a;
    details.push({ label: 'Audience', value: `${tax.audience || 'not set'} → ${a}` });
    changed.push('audience');
  }

  if (input.product_type !== undefined) {
    const t = String(input.product_type ?? '').trim();
    if (!t) return { error: 'product_type cannot be empty.' };
    const { picked, unknown } = pickFromVocabulary([t], vocab.product_types);
    if (unknown.length) return { error: `"${t}" is not a product type for ${kind}. Allowed: ${show(vocab.product_types)}.` };
    set[`${kind}.taxonomy.product_type`] = picked[0];
    details.push({ label: 'Product type', value: `${tax.product_type || 'not set'} → ${picked[0]}` });
    changed.push('product type');
  }

  const cats = asStrings(input.categories);
  if (cats) {
    if (!cats.length) return { error: 'categories cannot be empty; a product needs at least one.' };
    const { picked, unknown } = pickFromVocabulary(cats, vocab.categories);
    if (unknown.length) return { error: `Not in the allowed categories: ${unknown.join(', ')}. Allowed: ${show(vocab.categories)}.` };
    set[`${kind}.taxonomy.categories`] = picked;
    details.push({ label: 'Categories', value: `${show(tax.categories)} → ${picked.join(', ')}` });
    changed.push('categories');
  }

  const attrs = asStrings(input.attributes);
  if (attrs) {
    const { picked, unknown } = pickFromVocabulary(attrs, vocab.attributes);
    if (unknown.length) return { error: `Not in the allowed attributes: ${unknown.join(', ')}. Allowed: ${show(vocab.attributes)}.` };
    set[`${kind}.taxonomy.attributes`] = picked;
    details.push({ label: 'Attributes', value: `${show(tax.attributes)} → ${show(picked)}` });
    changed.push('attributes');
  }

  if (!changed.length) return { error: 'Nothing to change: give a description, audience, product_type, categories or attributes.' };
  return { set, details, changed };
}
