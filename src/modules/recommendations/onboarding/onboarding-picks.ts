// The rules behind the "pick looks you love" step at sign-up, kept free of
// Nest and Mongo so they can be tested on their own.
//
// Looks come from real listings first; the platform style library fills the
// screen when there are too few. The grid must not repeat itself: a few looks
// per vendor and per category at most, and no two looks that are near-copies
// (judged by the product's style embedding).

export type OnboardingGender = 'male' | 'female';

export interface Look {
  id: string;
  kind: 'product' | 'style';
  name: string;
  image: string;
  /** A short style word shown under the photo (category or style name). */
  label: string;
  vendor: { id: string; name: string } | null;
}

/** A candidate before it is chosen; `vector` and the keys drive the variety rules. */
export interface Candidate {
  look: Look;
  vendorKey?: string;
  categoryKey?: string;
  vector?: number[] | null;
}

export interface VarietyRules {
  limit: number;
  perVendor: number;
  perCategory: number;
  /** Two looks closer than this (cosine) count as the same look. */
  maxSimilarity: number;
}

export const LOOK_RULES: VarietyRules = {
  limit: 18,
  perVendor: 2,
  perCategory: 3,
  maxSimilarity: 0.95,
};

/** Fewer real looks than this and platform styles fill the gap. */
export const MIN_PRODUCT_LOOKS = 12;

/** Platform style categories that show a whole look (not a sleeve or neckline). */
export const LOOK_STYLE_CATEGORIES = ['full_body', 'skirt', 'trouser'];

const MEN = ['male', 'man', 'men', 'mens', "men's", 'm', 'boys', 'boy'];
const WOMEN = ['female', 'woman', 'women', 'womens', "women's", 'f', 'girls', 'girl', 'ladies'];
const UNISEX = ['unisex', 'all', 'everyone', 'any', 'both'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mongo regex for a clothing audience that suits this shopper: their own plus
 * unisex, any spelling the product facts accept, any case.
 */
export function audienceRegex(gender: OnboardingGender): RegExp {
  const words = [...(gender === 'male' ? MEN : WOMEN), ...UNISEX];
  return new RegExp(`^\\s*(${words.map(escape).join('|')})\\s*$`, 'i');
}

export function normalizeGender(value: unknown): OnboardingGender | null {
  const s = String(value ?? '').toLowerCase().trim();
  if (MEN.includes(s)) return 'male';
  if (WOMEN.includes(s)) return 'female';
  return null;
}

export function cosine(a?: number[] | null, b?: number[] | null): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/** The average direction of several vectors (null when none have one). */
export function centroid(vectors: (number[] | null | undefined)[]): number[] | null {
  const list = vectors.filter((v): v is number[] => !!v?.length);
  if (!list.length) return null;
  const dim = list[0].length;
  const out = new Array(dim).fill(0);
  for (const v of list) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  return out.map((x) => x / list.length);
}

/**
 * Walk the candidates in order and keep each one that doesn't break a variety
 * rule. `against` are looks already on screen: nothing too close to them gets in.
 */
export function pickVaried(
  candidates: Candidate[],
  rules: VarietyRules,
  against: Candidate[] = [],
): Candidate[] {
  const chosen: Candidate[] = [];
  const perVendor = new Map<string, number>();
  const perCategory = new Map<string, number>();
  const seen = new Set(against.map((c) => `${c.look.kind}:${c.look.id}`));
  const vectors = against.map((c) => c.vector).filter((v): v is number[] => !!v?.length);

  for (const c of candidates) {
    if (chosen.length >= rules.limit) break;
    const key = `${c.look.kind}:${c.look.id}`;
    if (seen.has(key)) continue;
    const vendor = c.vendorKey?.toLowerCase();
    const category = c.categoryKey?.toLowerCase();
    if (vendor && (perVendor.get(vendor) ?? 0) >= rules.perVendor) continue;
    if (category && (perCategory.get(category) ?? 0) >= rules.perCategory) continue;
    if (c.vector?.length && vectors.some((v) => cosine(v, c.vector) > rules.maxSimilarity)) continue;

    chosen.push(c);
    seen.add(key);
    if (vendor) perVendor.set(vendor, (perVendor.get(vendor) ?? 0) + 1);
    if (category) perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    if (c.vector?.length) vectors.push(c.vector);
  }
  return chosen;
}

/** Fisher–Yates; `rand` is injectable so tests are stable. */
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The style words saved on the profile from what was picked: product
 * categories, style names and a couple of each style's attributes. Lower-case,
 * no repeats, capped so a long pick list can't flood the profile.
 */
export function styleWords(
  products: { categories?: string[]; productType?: string }[],
  styles: { name?: string; attributes?: string[] }[],
  cap = 24,
): string[] {
  const out: string[] = [];
  const add = (w?: string) => {
    const s = String(w ?? '').trim().toLowerCase();
    if (s && s.length <= 40 && !out.includes(s)) out.push(s);
  };
  for (const s of styles) {
    add(s.name);
    (s.attributes ?? []).slice(0, 2).forEach(add);
  }
  for (const p of products) {
    (p.categories ?? []).slice(0, 2).forEach(add);
    if (!p.categories?.length) add(p.productType);
  }
  return out.slice(0, cap);
}
