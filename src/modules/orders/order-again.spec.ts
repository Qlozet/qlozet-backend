import {
  deliveredAtOf,
  fitPromptDue,
  lineKeyFor,
  reorderLinesFrom,
  unitsOf,
} from './order-again';
import { notificationRoute } from '../push/notification-route';
import { pushAllowed, switchFor } from '../push/push-preferences';

const P = '64b000000000000000000001';
const V = '64b000000000000000000002';
const S = '64b000000000000000000003';
const F = '64b000000000000000000004';
const AF = '64b000000000000000000005';

describe('reorderLinesFrom', () => {
  it('rebuilds a ready-to-wear line with the cart variant id, at one per unit', () => {
    const order = {
      items: [
        {
          _id: 'i1',
          product: P,
          product_kind: 'clothing',
          color_variant_selections: [
            { variant_id: V, size: 'M', color: 'Black', price: 9000, quantity: 2, total_amount: 18000 },
          ],
        },
      ],
    };
    const { lines, skipped } = reorderLinesFrom(order);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.productId).toBe(P);
    expect(l.quantity).toBe(2);
    expect(l.selections.color_variant_selections).toEqual([
      { color_variant_id: V, size: 'M', quantity: 1 },
    ]);
    expect(l.size).toBe('M');
    expect(l.color).toBe('Black');
    expect(l.measurementSet).toBeUndefined();
    // No prices are carried over: the cart prices it again.
    expect(JSON.stringify(l)).not.toContain('9000');
    expect(l.lineKey).toBe(lineKeyFor(l));
  });

  it('keeps a made-to-measure line\'s styles, fabric, applied fabric, note and set', () => {
    const order = {
      items: [
        {
          _id: 'i2',
          product: { _id: P },
          product_kind: 'clothing',
          clothing_type: 'customize',
          style_selections: [{ style_id: S, price: 2000, quantity: 1 }],
          fabric_selections: [{ fabric_id: F, yardage: 3, quantity: 1, price: 500 }],
          applied_fabric: AF,
          applied_fabric_yards: 4,
          applied_fabric_size: 'L',
          note: 'Slim sleeves',
          body_profile: { set_name: 'For Tolu', measurements: {}, unit: 'cm' },
        },
      ],
    };
    const [l] = reorderLinesFrom(order).lines;
    expect(l.selections.style_selections).toEqual([{ style_id: S, quantity: 1 }]);
    expect(l.selections.fabric_selections).toEqual([{ fabric_id: F, yardage: 3, quantity: 1 }]);
    expect(l.appliedFabricId).toBe(AF);
    expect(l.appliedFabricYards).toBe(4);
    expect(l.appliedFabricSize).toBe('L');
    expect(l.note).toBe('Slim sleeves');
    expect(l.measurementSet).toBe('For Tolu');
  });

  it('keeps a fabric cut as bought, by the piece or by the yard', () => {
    const order = {
      items: [
        { _id: 'a', product: P, product_kind: 'fabric', fabric_selections: [{ fabric_id: F, pieces: 2, yardage: 12, quantity: 2 }] },
        { _id: 'b', product: P, product_kind: 'fabric', fabric_selections: [{ fabric_id: F, yardage: 5, quantity: 1 }] },
      ],
    };
    const [byPiece, byYard] = reorderLinesFrom(order).lines;
    expect(byPiece.selections.fabric_selections).toEqual([{ fabric_id: F, pieces: 2 }]);
    expect(byPiece.quantity).toBe(1);
    expect(byYard.selections.fabric_selections).toEqual([{ fabric_id: F, yardage: 5, quantity: 1 }]);
  });

  it('skips bespoke lines and can pick one item', () => {
    const order = {
      items: [
        { _id: 'x', product: null, business: V },
        { _id: 'y', product: P, product_kind: 'accessory', accessory_selections: [{ accessory_id: S, variant_id: V, quantity: 3 }] },
      ],
    };
    const all = reorderLinesFrom(order);
    expect(all.skipped).toHaveLength(1);
    expect(all.skipped[0].item_id).toBe('x');
    expect(all.lines).toHaveLength(1);
    expect(all.lines[0].quantity).toBe(3);

    const one = reorderLinesFrom(order, 'y');
    expect(one.skipped).toHaveLength(0);
    expect(one.lines.map((l) => l.item_id)).toEqual(['y']);
  });

  it('caps silly counts', () => {
    expect(unitsOf({ color_variant_selections: [{ quantity: 500 }] })).toBe(20);
    expect(unitsOf({})).toBe(1);
  });
});

describe('fit nudge timing', () => {
  const now = new Date('2026-11-22T11:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const base = (over: any = {}) => ({
    status: 'completed',
    type: 'standard',
    items: [{ clothing_type: 'customize' }],
    shipments: [{ delivered_at: daysAgo(4) }],
    fit_feedback: null,
    fit_prompt_sent_at: null,
    ...over,
  });

  it('asks 3 to 30 days after the last parcel', () => {
    expect(fitPromptDue(base(), now)).toBe(true);
    expect(fitPromptDue(base({ shipments: [{ delivered_at: daysAgo(2) }] }), now)).toBe(false);
    expect(fitPromptDue(base({ shipments: [{ delivered_at: daysAgo(31) }] }), now)).toBe(false);
  });

  it('asks once, and only about made-to-measure pieces', () => {
    expect(fitPromptDue(base({ fit_prompt_sent_at: daysAgo(1) }), now)).toBe(false);
    expect(fitPromptDue(base({ fit_feedback: { fit: 'perfect' } }), now)).toBe(false);
    expect(fitPromptDue(base({ items: [{ clothing_type: 'ready_to_wear' }] }), now)).toBe(false);
    expect(fitPromptDue(base({ type: 'bespoke', items: [{}] }), now)).toBe(true);
    expect(fitPromptDue(base({ status: 'in_transit' }), now)).toBe(false);
  });

  it('uses the latest parcel that was not declined', () => {
    const at = deliveredAtOf({
      shipments: [
        { delivered_at: daysAgo(10) },
        { delivered_at: daysAgo(5) },
        { rejected: true, delivered_at: daysAgo(1) },
      ],
    });
    expect(at?.getTime()).toBe(daysAgo(5).getTime());
  });
});

describe('fit nudge routing and push switch', () => {
  const n = {
    type: 'fit_feedback_request',
    category: 'order',
    audience: 'customer',
    metadata: { order_reference: 'ORD-1' },
  };

  it('opens the order at the fit card', () => {
    expect(notificationRoute(n)).toBe('/profile?tab=orders&order=ORD-1&view=fit');
  });

  it('falls under its own switch, which can be turned off', () => {
    expect(switchFor(n)).toBe('feedback');
    expect(pushAllowed({ customer: { feedback: false } }, 'customer', n)).toBe(false);
    expect(pushAllowed({ customer: { orders: false } }, 'customer', n)).toBe(true);
  });
});
