import { roundToSellable } from '../products/fabric-pieces';

/**
 * Where a bespoke garment's fabric comes from, and what it costs. Worked out
 * here once, frozen on the quote when the tailor sends it, and read by the
 * shop, the vendor app and acceptance, so nobody guesses a price.
 *
 * - other_vendor:   the customer picked another vendor's fabric. Priced from
 *                   that listing (whole pieces if sold by the piece), charged
 *                   ON TOP of the quote and paid in full at acceptance, since
 *                   that vendor ships it straight away.
 * - tailor_stock:   the customer picked a fabric from the tailor's own shop.
 *                   Priced from the tailor's listing, part of the quote.
 * - tailor_sourced: no fabric chosen; the tailor buys it and types the cost.
 *                   Part of the quote.
 *
 * Fabric inside the quote sets a floor on the deposit (see
 * orders/bespoke-payment-plan.ts): the tailor is out of pocket for it before
 * cutting, so the deposit is never less than the fabric.
 */
export type FabricSource = 'other_vendor' | 'tailor_stock' | 'tailor_sourced';

/**
 * A garment can need more than one fabric. The main fabric is the design's
 * `fabric`; the others are `extra_fabrics`, one per role. Each is priced on
 * its own, the same way, and gets its own Fabric line when it is inside the
 * quote ("Fabric" for the main one, "Fabric (Lining)" for a lining).
 * A slot the tailor fills can carry the colour the customer wants (`color`).
 */
export const EXTRA_FABRIC_ROLES = ['contrast', 'lining', 'bottom'] as const;
export type ExtraFabricRole = (typeof EXTRA_FABRIC_ROLES)[number];
export type FabricRole = 'main' | ExtraFabricRole;

export const FABRIC_ROLE_NAMES: Record<FabricRole, string> = {
  main: 'Main fabric',
  contrast: 'Contrast fabric',
  lining: 'Lining',
  // A two-piece set whose bottom (trousers, skirt) is in a different fabric;
  // the main fabric is then the top's.
  bottom: 'Bottom fabric',
};

export const fabricLineLabel = (role: FabricRole = 'main') =>
  role === 'main' ? 'Fabric' : `Fabric (${role[0].toUpperCase()}${role.slice(1)})`;

export interface QuoteFabric {
  /** Which fabric of the garment this is. Absent on quotes before 2 Nov 2026 (= main). */
  role?: FabricRole;
  source: FabricSource;
  /** The fabric product, or null when the tailor sources it. */
  product: string | null;
  name: string | null;
  /** Business selling the fabric (null when the tailor sources it). */
  supplier: string | null;
  supplier_name: string | null;
  /** Yards charged for (rounded up to whole pieces for piece-only fabric). */
  yards: number | null;
  pieces: number | null;
  price_per_yard: number | null;
  piece_price: number | null;
  amount: number;
  /** True when `amount` is a line of the quote (counted in quote.total). */
  in_quote: boolean;
}

export const FABRIC_LINE_LABEL = 'Fabric';

const isFabricLine = (li: { label?: string }, role: FabricRole = 'main') =>
  String(li?.label ?? '').trim().toLowerCase() === fabricLineLabel(role).toLowerCase();

export function fabricSourceFor(
  fabricProduct: any | null | undefined,
  tailorId: string,
): FabricSource {
  if (!fabricProduct) return 'tailor_sourced';
  return String(fabricProduct.business?._id ?? fabricProduct.business) ===
    String(tailorId)
    ? 'tailor_stock'
    : 'other_vendor';
}

/** The amount the tailor typed on the Fabric line (tailor_sourced only). */
export function typedFabricAmount(
  lineItems: { label?: string; amount?: number }[] = [],
  role: FabricRole = 'main',
): number {
  const line = lineItems.find((li) => isFabricLine(li, role));
  return Math.max(0, Math.round(Number(line?.amount) || 0));
}

export function priceQuoteFabric(opts: {
  fabricProduct: any | null | undefined;
  tailorId: string;
  yards?: number | null;
  lineItems?: { label?: string; amount?: number }[];
  supplierName?: string | null;
  role?: FabricRole;
}): QuoteFabric {
  const { fabricProduct, tailorId } = opts;
  const role: FabricRole = opts.role ?? 'main';
  const source = fabricSourceFor(fabricProduct, tailorId);
  const yards = Number(opts.yards) > 0 ? Number(opts.yards) : null;

  if (source === 'tailor_sourced') {
    return {
      role,
      source,
      product: null,
      name: null,
      supplier: null,
      supplier_name: null,
      yards,
      pieces: null,
      price_per_yard: null,
      piece_price: null,
      amount: typedFabricAmount(opts.lineItems, role),
      in_quote: true,
    };
  }

  const f = fabricProduct.fabric ?? {};
  const sellable = yards ? roundToSellable(f, yards) : null;
  return {
    role,
    source,
    product: String(fabricProduct._id),
    name: f.name ?? fabricProduct.name ?? null,
    supplier: String(fabricProduct.business?._id ?? fabricProduct.business),
    supplier_name: opts.supplierName ?? null,
    yards: sellable ? sellable.yards : null,
    pieces: sellable ? sellable.pieces : null,
    price_per_yard: Number(f.price_per_yard) || null,
    piece_price: Number(f.piece_price) || null,
    amount: sellable ? Math.round(sellable.cost) : 0,
    in_quote: source === 'tailor_stock',
  };
}

/**
 * The quote's line items with the Fabric line made to match the priced
 * fabric: set (or added) for fabric inside the quote, removed when another
 * vendor's fabric is billed on top, so it can never be counted twice.
 */
export function applyFabricLine<T extends { label?: string; amount?: number }>(
  lineItems: T[],
  fabric: QuoteFabric,
): T[] {
  const role = fabric.role ?? 'main';
  const rest = lineItems.filter((li) => !isFabricLine(li, role));
  if (!fabric.in_quote) return rest;
  const idx = lineItems.findIndex((li) => isFabricLine(li, role));
  const line = { label: fabricLineLabel(role), amount: fabric.amount } as T;
  if (idx < 0) return [...rest, line];
  const out = [...rest];
  out.splice(idx, 0, line);
  return out;
}

/** Yards in stock on the fabric listing, or null when not tracked. */
export function fabricYardsInStock(fabricProduct: any): number | null {
  const n = Number(fabricProduct?.fabric?.yard_length);
  return Number.isFinite(n) ? n : null;
}

/** Every priced fabric on a quote: the main one, then the extra ones. */
export function quoteFabrics(quote: any): QuoteFabric[] {
  return [quote?.fabric_pricing, ...((quote?.extra_fabric_pricing as any[]) ?? [])].filter(
    Boolean,
  ) as QuoteFabric[];
}

/**
 * The deposit floor a quote's fabric sets: every fabric inside the quote
 * (another vendor's fabric is billed on top, so it sets none).
 */
export function fabricDepositFloor(fabric?: QuoteFabric | QuoteFabric[] | null): number {
  const list = Array.isArray(fabric) ? fabric : fabric ? [fabric] : [];
  return list.reduce(
    (sum, f) => sum + (f?.in_quote ? Math.max(0, Math.round(f.amount || 0)) : 0),
    0,
  );
}

/** What the customer pays on top of the quote: other vendors' fabric. */
export function fabricOnTop(fabrics: QuoteFabric[]): number {
  return fabrics.reduce(
    (sum, f) => sum + (f && !f.in_quote ? Math.max(0, Math.round(f.amount || 0)) : 0),
    0,
  );
}

/** What the vendor app needs to price fabric live as the tailor types yards. */
export function fabricOffer(fabricProduct: any | null | undefined, tailorId: string, supplierName?: string | null) {
  const source = fabricSourceFor(fabricProduct, tailorId);
  if (source === 'tailor_sourced') return { source };
  const f = fabricProduct.fabric ?? {};
  return {
    source,
    product: String(fabricProduct._id),
    name: f.name ?? fabricProduct.name ?? null,
    supplier_name: supplierName ?? null,
    sold_by: f.sold_by ?? 'yard',
    price_per_yard: Number(f.price_per_yard) || null,
    piece_yards: Number(f.piece_yards) || null,
    piece_price: Number(f.piece_price) || null,
    min_cut: Number(f.min_cut) || null,
    yards_in_stock: fabricYardsInStock(fabricProduct),
  };
}
