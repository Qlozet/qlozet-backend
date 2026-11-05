/**
 * Default styles on made-to-order clothing.
 *
 * A custom listing offers styles per part of the garment (neckline, sleeve,
 * collar, skirt, trouser, full_body...). The listing photo
 * shows one of each, so the price a shopper sees and pays must include them:
 * otherwise "Add to cart" without opening the customizer bought the outfit
 * for its craftsmanship price alone.
 *
 * Each part has one default: the style the vendor marked `is_default`, or,
 * when they have not marked one, the cheapest (the first on a tie). Every
 * order fills each part the customer left empty with that default. The
 * customer's own picks are never replaced.
 *
 * One definition, used by pricing, the stored order lines, the listing's
 * `default_styles_price` and the vendor form (which mirrors it).
 */

export interface StyleLike {
  _id?: unknown;
  type?: string | null;
  categories?: string[] | null;
  price?: number | null;
  is_default?: boolean | null;
}

/** The parts a style can be for (style-library StyleCategory). */
export const STYLE_PARTS = [
  'neckline',
  'sleeve',
  'collar',
  'skirt',
  'trouser',
  'full_body',
  'bodice',
  'hemline',
  'back',
] as const;

const clean = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase();

/**
 * The part of the garment a style belongs to, or null when it has none.
 * A library style carries its part in `categories` (its `type` is only
 * top/bottom/full_body); a vendor's own style may carry it in `type`. Same
 * order the shop groups them in.
 */
export function stylePart(style: StyleLike | null | undefined): string | null {
  if (!style) return null;
  const parts = STYLE_PARTS as readonly string[];
  const cats = (style.categories ?? []).map(clean);
  const type = clean(style.type);
  return (
    cats.find((c) => parts.includes(c)) ??
    (parts.includes(type) ? type : null) ??
    (cats[0] || type || null)
  );
}

const priceOf = (s: StyleLike) => {
  const n = Number(s?.price);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The default style for each part: the vendor's pick, else the cheapest. */
export function defaultStylesByPart<T extends StyleLike>(
  styles: T[] | null | undefined,
): Map<string, T> {
  const marked = new Map<string, T>();
  const cheapest = new Map<string, T>();
  for (const s of styles ?? []) {
    const part = stylePart(s);
    if (!part) continue;
    if (s.is_default && !marked.has(part)) marked.set(part, s);
    const best = cheapest.get(part);
    if (!best || priceOf(s) < priceOf(best)) cheapest.set(part, s);
  }
  const out = new Map<string, T>();
  for (const [part, s] of cheapest) out.set(part, marked.get(part) ?? s);
  return out;
}

/** What the defaults add to the craftsmanship price: the outfit as pictured. */
export function defaultStylesPrice(styles: StyleLike[] | null | undefined) {
  let total = 0;
  for (const s of defaultStylesByPart(styles).values()) total += priceOf(s);
  return Math.round(total * 100) / 100;
}

/**
 * The customer's picks plus the default for every part they left empty.
 * Picks come first and are never changed; an id that is not on the listing
 * passes through so the caller can reject it as before.
 */
export function withDefaultStyles<P extends { style_id?: unknown }, S extends StyleLike>(
  picks: P[] | null | undefined,
  styles: S[] | null | undefined,
  make: (style: S) => P,
): P[] {
  const list = [...(picks ?? [])];
  const covered = new Set<string>();
  for (const p of list) {
    const style = (styles ?? []).find(
      (s) => s._id != null && String(s._id) === String(p?.style_id),
    );
    const part = stylePart(style);
    if (part) covered.add(part);
  }
  for (const [part, style] of defaultStylesByPart(styles)) {
    if (!covered.has(part)) list.push(make(style));
  }
  return list;
}

/**
 * Leave at most one marked default per part (the first one wins), so a
 * listing never says two necklines are "the one in the photo".
 */
export function keepOneDefaultPerPart<T extends StyleLike>(
  styles: T[] | null | undefined,
): void {
  const seen = new Set<string>();
  for (const s of styles ?? []) {
    if (!s.is_default) continue;
    const part = stylePart(s);
    if (!part || seen.has(part)) s.is_default = false;
    else seen.add(part);
  }
}

/** Whether a product's styles take part: made-to-order clothing only. */
export function usesDefaultStyles(product: {
  kind?: string | null;
  clothing?: { type?: string | null; styles?: unknown[] | null } | null;
}): boolean {
  return (
    product?.kind === 'clothing' &&
    product.clothing?.type === 'customize' &&
    (product.clothing?.styles?.length ?? 0) > 0
  );
}
