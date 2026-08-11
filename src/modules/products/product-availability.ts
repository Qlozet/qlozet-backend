// ─── Product availability ─────────────────────────────────────────────────
// Pure, side-effect-free computation of a product's stock availability, shared
// by the storefront (PDP + listings) so the UI can disable out-of-stock options
// and surface "low stock" nudges instead of failing only at checkout.
//
// Availability is per-variant: a product is only "out of stock" when EVERY
// variant is. Kinds:
//   • clothing  → color_variants[].variants[].stock (customize = made-to-order)
//   • accessory → accessory.variants[].stock (no variants = base, not tracked)
//   • fabric    → fabric.yard_length vs fabric.min_cut

export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface VariantAvailability {
  _id: string;
  label?: string; // e.g. "Red / M"
  color?: string;
  size?: string;
  stock: number;
  state: StockState;
}

export interface ProductAvailability {
  state: StockState; // product-level rollup
  in_stock: boolean; // purchasable at all
  low_stock: boolean; // in stock but limited
  made_to_order?: boolean; // customize clothing — not stock-gated
  total_stock?: number; // clothing / accessory
  fabric?: {
    yard_length: number;
    min_cut: number;
    low_yards: number;
    available: boolean;
  };
  variants?: VariantAvailability[]; // per-variant, for PDP option gating
}

export interface StockThresholds {
  /** Units at or below which a variant is "low stock". */
  lowStock: number;
  /** Yards below which a fabric is "low stock"; 0 → fall back to 2× min_cut. */
  lowFabricYards: number;
}

export const DEFAULT_STOCK_THRESHOLDS: StockThresholds = {
  lowStock: 5,
  lowFabricYards: 0,
};

function variantState(stock: number, lowStock: number): StockState {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= lowStock) return 'low_stock';
  return 'in_stock';
}

function rollup(
  variants: VariantAvailability[],
  total: number,
  lowStock: number,
): ProductAvailability {
  const anyIn = variants.some((v) => v.stock > 0);
  const state: StockState = !anyIn
    ? 'out_of_stock'
    : total <= lowStock
      ? 'low_stock'
      : 'in_stock';
  return {
    state,
    in_stock: anyIn,
    low_stock: state === 'low_stock',
    total_stock: total,
    variants,
  };
}

export function computeAvailability(
  product: any,
  thresholds: StockThresholds = DEFAULT_STOCK_THRESHOLDS,
): ProductAvailability {
  const lowStock = thresholds.lowStock > 0 ? thresholds.lowStock : 5;
  const kind = product?.kind;

  if (kind === 'clothing') {
    const clothing = product.clothing || {};
    // Customize garments are made-to-order — no stock gate.
    if (clothing.type === 'customize') {
      return { state: 'in_stock', in_stock: true, low_stock: false, made_to_order: true };
    }
    const variants: VariantAvailability[] = [];
    let total = 0;
    for (const cv of clothing.color_variants || []) {
      for (const v of cv.variants || []) {
        const stock = v?.stock ?? 0;
        total += stock;
        variants.push({
          _id: String(v?._id),
          color: cv?.name,
          size: v?.size,
          label: [cv?.name, v?.size].filter(Boolean).join(' / '),
          stock,
          state: variantState(stock, lowStock),
        });
      }
    }
    // No color variants defined at all → nothing to gate on; treat as available.
    if (variants.length === 0) {
      return { state: 'in_stock', in_stock: true, low_stock: false };
    }
    return rollup(variants, total, lowStock);
  }

  if (kind === 'accessory') {
    const accessory = product.accessory || {};
    const vs = accessory.variants || [];
    // No variants → base-priced, no per-variant stock tracked. Available unless
    // the vendor explicitly flagged it out of stock.
    if (vs.length === 0) {
      const available = accessory.in_stock !== false;
      return {
        state: available ? 'in_stock' : 'out_of_stock',
        in_stock: available,
        low_stock: false,
      };
    }
    const variants: VariantAvailability[] = [];
    let total = 0;
    for (const v of vs) {
      const stock = v?.stock ?? 0;
      total += stock;
      variants.push({
        _id: String(v?._id),
        size: v?.size,
        label: v?.size,
        stock,
        state: variantState(stock, lowStock),
      });
    }
    return rollup(variants, total, lowStock);
  }

  if (kind === 'fabric') {
    const fabric = product.fabric || {};
    const yard = fabric.yard_length ?? 0;
    const minCut = fabric.min_cut ?? 0;
    const lowYards =
      thresholds.lowFabricYards > 0 ? thresholds.lowFabricYards : minCut * 2;
    const available = minCut > 0 && yard >= minCut;
    const state: StockState = !available
      ? 'out_of_stock'
      : yard < lowYards
        ? 'low_stock'
        : 'in_stock';
    return {
      state,
      in_stock: available,
      low_stock: state === 'low_stock',
      fabric: { yard_length: yard, min_cut: minCut, low_yards: lowYards, available },
    };
  }

  // Unknown kind — don't block.
  return { state: 'in_stock', in_stock: true, low_stock: false };
}

/** Attach `availability` to a product (plain object or Mongoose doc). */
export function withAvailability(product: any, thresholds?: StockThresholds): any {
  if (!product) return product;
  const plain =
    typeof product.toObject === 'function' ? product.toObject() : product;
  return { ...plain, availability: computeAvailability(plain, thresholds) };
}
