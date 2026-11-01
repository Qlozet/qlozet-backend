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

export interface QuoteFabric {
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

const isFabricLine = (li: { label?: string }) =>
  String(li?.label ?? '').trim().toLowerCase() === 'fabric';

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
export function typedFabricAmount(lineItems: { label?: string; amount?: number }[] = []): number {
  const line = lineItems.find(isFabricLine);
  return Math.max(0, Math.round(Number(line?.amount) || 0));
}

export function priceQuoteFabric(opts: {
  fabricProduct: any | null | undefined;
  tailorId: string;
  yards?: number | null;
  lineItems?: { label?: string; amount?: number }[];
  supplierName?: string | null;
}): QuoteFabric {
  const { fabricProduct, tailorId } = opts;
  const source = fabricSourceFor(fabricProduct, tailorId);
  const yards = Number(opts.yards) > 0 ? Number(opts.yards) : null;

  if (source === 'tailor_sourced') {
    return {
      source,
      product: null,
      name: null,
      supplier: null,
      supplier_name: null,
      yards,
      pieces: null,
      price_per_yard: null,
      piece_price: null,
      amount: typedFabricAmount(opts.lineItems),
      in_quote: true,
    };
  }

  const f = fabricProduct.fabric ?? {};
  const sellable = yards ? roundToSellable(f, yards) : null;
  return {
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
  const rest = lineItems.filter((li) => !isFabricLine(li));
  if (!fabric.in_quote) return rest;
  const idx = lineItems.findIndex(isFabricLine);
  const line = { label: FABRIC_LINE_LABEL, amount: fabric.amount } as T;
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

/** The deposit floor a quote's fabric sets (0 when it is billed on top). */
export function fabricDepositFloor(fabric?: QuoteFabric | null): number {
  return fabric?.in_quote ? Math.max(0, Math.round(fabric.amount || 0)) : 0;
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
