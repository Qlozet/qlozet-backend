/**
 * "Order again" and "Your tailors": the rules, kept pure so they can be
 * tested without a database.
 *
 * Reorder rebuilds cart lines from what the order recorded: the same size and
 * colour, styles, fabric, accessories, add-ons, applied fabric, note and the
 * measurement set the piece was sewn to. Prices are NOT copied; the cart
 * prices each line again at today's price.
 *
 * Quantities: an order item has no top-level quantity, the count lives on its
 * selections. A reordered garment goes in as `quantity` cart units with each
 * selection at 1, which is how the shop and the app build lines. Fabric keeps
 * its recorded cut (yards or pieces) as one line.
 */

export interface ReorderLine {
  /** The order item it came from. */
  item_id: string;
  productId: string;
  quantity: number;
  selections: Record<string, any[]>;
  size?: string;
  color?: string;
  measurementSet?: string;
  appliedFabricId?: string;
  appliedFabricYards?: number;
  appliedFabricSize?: string;
  note?: string;
  lineKey: string;
}

export interface ReorderSkip {
  item_id: string;
  product_id: string | null;
  reason: string;
}

const id = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const raw = v?._id ?? v;
  const s = String(raw);
  return s && s !== '[object Object]' ? s : null;
};

const clean = <T extends Record<string, any>>(o: T): T => {
  const out: any = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
};

/** Garments in one order line (the selections carry the count). */
export function unitsOf(item: any): number {
  const n =
    item?.color_variant_selections?.[0]?.quantity ??
    item?.accessory_selections?.[0]?.quantity ??
    item?.style_selections?.[0]?.quantity ??
    1;
  const q = Math.round(Number(n));
  return Number.isFinite(q) && q > 0 ? Math.min(q, 20) : 1;
}

/** The same identity the shop and the app give a cart line. */
export function lineKeyFor(l: {
  productId: string;
  size?: string;
  color?: string;
  appliedFabricId?: string;
  selections?: Record<string, any[]>;
  measurementSet?: string;
}): string {
  return [
    l.productId,
    l.size ?? '',
    l.color ?? '',
    l.appliedFabricId ?? '',
    l.selections ? JSON.stringify(l.selections) : '',
    l.measurementSet ?? '',
  ].join('|');
}

/**
 * Cart lines for an order's items (all of them, or the one `itemId`).
 * Bespoke lines have no listing to put back in a cart and are skipped.
 */
export function reorderLinesFrom(
  order: any,
  itemId?: string,
): { lines: ReorderLine[]; skipped: ReorderSkip[] } {
  const lines: ReorderLine[] = [];
  const skipped: ReorderSkip[] = [];
  const items: any[] = (order?.items ?? []).filter(
    (i: any) => !itemId || id(i?._id) === String(itemId),
  );

  for (const item of items) {
    const itemKey = id(item?._id) ?? '';
    const productId = id(item?.product);
    if (!productId) {
      skipped.push({
        item_id: itemKey,
        product_id: null,
        reason: 'Made from your own design, so it is not a listing you can add to the cart.',
      });
      continue;
    }

    const isFabric = item?.product_kind === 'fabric';
    const cv = (item.color_variant_selections ?? []).map((s: any) =>
      clean({
        color_variant_id: id(s.variant_id ?? s.color_variant_id),
        size: s.size,
        quantity: 1,
      }),
    );
    const fabrics = (item.fabric_selections ?? []).map((s: any) =>
      Number(s.pieces) > 0
        ? clean({ fabric_id: id(s.fabric_id), pieces: Number(s.pieces) })
        : clean({
            fabric_id: id(s.fabric_id),
            yardage: s.yardage,
            quantity: isFabric ? s.quantity ?? 1 : 1,
          }),
    );
    const styles = (item.style_selections ?? []).map((s: any) =>
      clean({ style_id: id(s.style_id), quantity: 1 }),
    );
    const accessories = (item.accessory_selections ?? []).map((s: any) =>
      clean({ accessory_id: id(s.accessory_id), variant_id: id(s.variant_id), quantity: 1 }),
    );
    const addons = (item.addon_selections ?? []).map((s: any) =>
      clean({ addon_id: id(s.addon_id), variant_id: id(s.variant_id), quantity: 1 }),
    );

    const selections: Record<string, any[]> = {};
    if (cv.length) selections.color_variant_selections = cv;
    if (fabrics.length) selections.fabric_selections = fabrics;
    if (styles.length) selections.style_selections = styles;
    if (accessories.length) selections.accessory_selections = accessories;
    if (addons.length) selections.addon_selections = addons;

    const size: string | undefined = item.color_variant_selections?.[0]?.size || undefined;
    const color: string | undefined = item.color_variant_selections?.[0]?.color || undefined;
    const measurementSet: string | undefined =
      item.clothing_type === 'customize'
        ? item.body_profile?.set_name || order?.customer_body_profile?.set_name || undefined
        : undefined;
    const appliedFabricId = id(item.applied_fabric) ?? undefined;

    const line: Omit<ReorderLine, 'lineKey'> = {
      item_id: itemKey,
      productId,
      quantity: isFabric ? 1 : unitsOf(item),
      selections,
      size,
      color,
      measurementSet,
      appliedFabricId,
      appliedFabricYards: appliedFabricId ? item.applied_fabric_yards ?? undefined : undefined,
      appliedFabricSize: appliedFabricId ? item.applied_fabric_size ?? undefined : undefined,
      note: item.note || undefined,
    };
    lines.push({ ...line, lineKey: lineKeyFor(line) });
  }
  return { lines, skipped };
}

/** Orders a customer has really bought (paid, not cancelled or sent back). */
export const BOUGHT_ORDER_FILTER = {
  payment_status: 'paid',
  status: { $nin: ['cancelled', 'returned'] },
};

/* ── The fit nudge ─────────────────────────────────────────────────────── */

/** Days after delivery before asking: long enough to try it on. */
export const FIT_PROMPT_AFTER_DAYS = 3;
/** Older deliveries are never asked (a launch would otherwise ask everyone). */
export const FIT_PROMPT_MAX_AGE_DAYS = 30;

/** When the order arrived: its last parcel, else when it last changed. */
export function deliveredAtOf(order: any): Date | null {
  const times = (order?.shipments ?? [])
    .filter((s: any) => !s?.rejected && s?.delivered_at)
    .map((s: any) => new Date(s.delivered_at).getTime())
    .filter((t: number) => Number.isFinite(t));
  if (times.length) return new Date(Math.max(...times));
  return order?.updatedAt ? new Date(order.updatedAt) : null;
}

/** Whether to ask this order "how did it fit?" now. Asked once, ever. */
export function fitPromptDue(order: any, now: Date = new Date()): boolean {
  if (order?.status !== 'completed') return false;
  if (order?.fit_feedback || order?.fit_prompt_sent_at) return false;
  const madeToFit =
    order?.type === 'bespoke' ||
    (order?.items ?? []).some((i: any) => i?.clothing_type === 'customize');
  if (!madeToFit) return false;
  const at = deliveredAtOf(order);
  if (!at) return false;
  const age = now.getTime() - at.getTime();
  return (
    age >= FIT_PROMPT_AFTER_DAYS * 86_400_000 &&
    age <= FIT_PROMPT_MAX_AGE_DAYS * 86_400_000
  );
}
