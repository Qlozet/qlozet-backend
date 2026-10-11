/**
 * Pure pieces of the vendor actions: matching names the model typed to the
 * vendor's real records, and shaping the discount the platform understands.
 * No database here, so it is all unit-testable with plain objects.
 */

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
