/**
 * The structured facts about a product that a shopper actually asks about -
 * who it is for, what colours it comes in, which sizes are in stock, whether
 * it is made to order - lifted out of the three kind sub-documents into one
 * flat shape.
 *
 * Used twice: the catalog sync stores it on the CatalogItem so the filters
 * can act on it across all candidates, and the stylist computes it from the
 * live product at answer time so the prompt never quotes stale stock.
 */

export type Audience = 'men' | 'women' | 'unisex';

export interface ProductFacts {
  /** men | women | unisex; undefined when the vendor never said. */
  audience?: Audience;
  colors: string[];
  /** Sizes a customer can buy right now (all listed sizes when stock is not tracked or the item is made to order). */
  sizes: string[];
  /** false only when the vendor tracks stock and all of it is gone; undefined = unknown, treat as available. */
  in_stock?: boolean;
  made_to_order?: boolean;
  turnaround_days?: number;
  material?: string;
  pattern?: string;
  /** Fabric only. */
  price_per_yard?: number;
  /** Set only when there is a real discount below base_price. */
  discounted_price?: number;
  rating?: number;
  rating_count?: number;
}

const MEN = new Set(['male', 'man', 'men', 'mens', "men's", 'm', 'boys', 'boy']);
const WOMEN = new Set(['female', 'woman', 'women', 'womens', "women's", 'f', 'girls', 'girl', 'ladies']);
const UNISEX = new Set(['unisex', 'all', 'everyone', 'any', 'both']);

export function normalizeAudience(value?: string | null): Audience | undefined {
  const s = String(value ?? '').toLowerCase().trim();
  if (!s) return undefined;
  if (MEN.has(s)) return 'men';
  if (WOMEN.has(s)) return 'women';
  if (UNISEX.has(s)) return 'unisex';
  return undefined;
}

const uniq = (values: unknown[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
};

/** What a list of size/stock variants says about availability. */
function stockOf(variants: any[]): { tracked: boolean; any: boolean; inStockSizes: string[]; allSizes: string[] } {
  const rows = (variants || []).filter(Boolean);
  const tracked = rows.some((v) => typeof v?.stock === 'number');
  const any = rows.some((v) => Number(v?.stock) > 0);
  return {
    tracked,
    any,
    allSizes: uniq(rows.map((v) => v?.size)),
    inStockSizes: uniq(rows.filter((v) => Number(v?.stock) > 0).map((v) => v?.size)),
  };
}

export function productFacts(product: any): ProductFacts {
  const facts: ProductFacts = { colors: [], sizes: [] };
  if (!product) return facts;

  const base = Number(product.base_price);
  const discounted = Number(product.discounted_price);
  if (discounted > 0 && base > 0 && discounted < base) facts.discounted_price = discounted;

  if (Number(product.total_ratings) > 0 && Number(product.average_rating) > 0) {
    facts.rating = Math.round(Number(product.average_rating) * 10) / 10;
    facts.rating_count = Number(product.total_ratings);
  }

  if (product.kind === 'clothing' && product.clothing) {
    const c = product.clothing;
    facts.audience = normalizeAudience(c.taxonomy?.audience);
    facts.colors = uniq((c.color_variants || []).map((cv: any) => cv?.name));
    facts.made_to_order = c.type === 'customize';
    if (Number(c.turnaround_days) > 0) facts.turnaround_days = Number(c.turnaround_days);
    const st = stockOf((c.color_variants || []).flatMap((cv: any) => cv?.variants || []));
    if (facts.made_to_order) {
      // Cut to order: every listed size can be bought, stock counts do not apply.
      facts.sizes = st.allSizes;
      facts.in_stock = true;
    } else {
      facts.sizes = st.tracked ? st.inStockSizes : st.allSizes;
      facts.in_stock = st.tracked ? st.any : undefined;
    }
    return facts;
  }

  if (product.kind === 'fabric' && product.fabric) {
    const f = product.fabric;
    facts.audience = normalizeAudience(f.taxonomy?.audience);
    facts.colors = uniq((f.colors || []).map((c: any) => c?.name));
    if (f.material) facts.material = String(f.material);
    if (f.pattern) facts.pattern = String(f.pattern);
    if (Number(f.price_per_yard) > 0) facts.price_per_yard = Number(f.price_per_yard);
    const st = stockOf(f.variants || []);
    facts.in_stock = st.tracked ? st.any : undefined;
    return facts;
  }

  if (product.kind === 'accessory' && product.accessory) {
    const a = product.accessory;
    facts.audience = normalizeAudience(a.taxonomy?.audience);
    facts.colors = uniq((a.variants || []).map((v: any) => v?.color?.name));
    const st = stockOf(a.variants || []);
    facts.sizes = st.tracked ? st.inStockSizes : st.allSizes;
    if (a.in_stock === false) facts.in_stock = false;
    else facts.in_stock = st.tracked ? st.any : undefined;
    return facts;
  }

  return facts;
}
