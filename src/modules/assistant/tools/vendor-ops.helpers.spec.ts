import { Types } from 'mongoose';
import {
  catalogueIssues,
  describeOrder,
  fulfilmentStats,
  quoteStats,
  reviewStats,
} from './vendor-ops.helpers';

const BID = new Types.ObjectId();
const OTHER = new Types.ObjectId();
const NOW = new Date('2026-10-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const order = (over: any = {}) => ({
  reference: 'QLZ-1',
  status: 'in_review',
  order_type: 'standard',
  createdAt: hoursAgo(10),
  items: [
    { business: BID, total_price: 20000 },
    { business: OTHER, total_price: 5000 },
    { business: BID, total_price: 1000, rejected: true },
  ],
  shipments: [{ business: BID, confirmed: false }, { business: OTHER, confirmed: true }],
  ...over,
});

describe('describeOrder', () => {
  it("reads the stage from the vendor's own shipment, and counts only their items", () => {
    const row = describeOrder(order(), BID, NOW);
    expect(row.stage).toBe('awaiting_confirmation');
    expect(row.needs_action).toBe(true);
    expect(row.items).toBe(1);
    expect(row.amount).toBe(20000);
    expect(row.age_hours).toBe(10);
  });

  it('walks confirmed -> shipped -> delivered, and flags an unshipped order past its deadline', () => {
    const confirmedLate = order({
      status: 'processing',
      shipments: [{ business: BID, confirmed: true, confirmed_at: hoursAgo(9), fulfillment_deadline: hoursAgo(2) }],
    });
    expect(describeOrder(confirmedLate, BID, NOW)).toMatchObject({ stage: 'awaiting_your_shipment', needs_action: true, overdue: true, hours_to_deadline: -2 });

    const shipped = order({
      status: 'in_transit',
      shipments: [{ business: BID, confirmed: true, shipped_at: hoursAgo(1), fulfillment_deadline: hoursAgo(2) }],
    });
    expect(describeOrder(shipped, BID, NOW)).toMatchObject({ stage: 'shipped', needs_action: false, overdue: false });

    const delivered = order({ status: 'in_transit', shipments: [{ business: BID, confirmed: true, shipped_at: hoursAgo(30), delivered_at: hoursAgo(1) }] });
    expect(describeOrder(delivered, BID, NOW).stage).toBe('delivered');
  });

  it('puts bespoke pre-ship states ahead of the shipment flags', () => {
    const changes = order({ order_type: 'bespoke', status: 'processing', preship: { status: 'changes_requested' }, shipments: [{ business: BID, confirmed: true }] });
    expect(describeOrder(changes, BID, NOW)).toMatchObject({ stage: 'preship_changes_requested', needs_action: true });
    const waiting = order({ order_type: 'bespoke', status: 'processing', preship: { status: 'pending_review' }, shipments: [{ business: BID, confirmed: true }] });
    expect(describeOrder(waiting, BID, NOW)).toMatchObject({ stage: 'preship_awaiting_customer', needs_action: false });
  });

  it('terminal and unpaid orders never need action', () => {
    for (const status of ['pending', 'completed', 'cancelled', 'returned']) {
      expect(describeOrder(order({ status }), BID, NOW).needs_action).toBe(false);
    }
    expect(describeOrder(order({ shipments: [{ business: BID, rejected: true }] }), BID, NOW).stage).toBe('rejected');
  });
});

describe('fulfilmentStats', () => {
  it('measures confirm, ship and transit times and the on-time rate from the vendor shipment', () => {
    const orders = [
      order({ createdAt: hoursAgo(100), shipments: [{ business: BID, confirmed: true, confirmed_at: hoursAgo(98), shipped_at: hoursAgo(50), delivered_at: hoursAgo(2), fulfillment_deadline: hoursAgo(40) }] }),
      order({ createdAt: hoursAgo(80), shipments: [{ business: BID, confirmed: true, confirmed_at: hoursAgo(74), shipped_at: hoursAgo(20), fulfillment_deadline: hoursAgo(30) }] }),
      order({ status: 'processing', createdAt: hoursAgo(60), shipments: [{ business: BID, confirmed: true, confirmed_at: hoursAgo(59), fulfillment_deadline: hoursAgo(5) }] }),
      order({ shipments: [{ business: BID, rejected: true }] }),
      order({ shipments: [{ business: OTHER, confirmed: true, shipped_at: hoursAgo(1) }] }),
      { ...order(), late_penalty_applied: true, late_penalty_amount: 1500, shipments: [{ business: BID, confirmed: true, confirmed_at: hoursAgo(1) }] },
    ];
    const s = fulfilmentStats(orders, BID, NOW);
    expect(s.orders_handled).toBe(5);
    expect(s.rejected).toBe(1);
    expect(s.confirmed).toBe(4);
    // 2h, 6h, 1h, and the penalty order's 9h (placed 10h ago, confirmed 1h ago).
    expect(s.avg_hours_to_confirm).toBeCloseTo((2 + 6 + 1 + 9) / 4, 1);
    expect(s.shipped).toBe(2);
    // 48h -> 2.0d and 54h -> 2.25d, each rounded to one decimal, then averaged and rounded again.
    expect(s.avg_days_to_ship).toBe(2.2);
    expect(s.delivered).toBe(1);
    expect(s.avg_days_in_transit).toBe(2);
    expect(s.late_shipments).toBe(1);
    expect(s.on_time_rate).toBe('50%');
    expect(s.still_open_past_deadline).toBe(1);
    expect(s.late_penalties).toEqual({ count: 1, amount: 1500 });
  });

  it('returns nulls, not NaN, with nothing to measure', () => {
    const s = fulfilmentStats([], BID, NOW);
    expect(s.avg_hours_to_confirm).toBeNull();
    expect(s.on_time_rate).toBeNull();
  });
});

describe('quoteStats', () => {
  it('sorts what is waiting oldest-first and computes the win rate over decided quotes only', () => {
    const quotes = [
      { reference: 'Q1', status: 'pending', createdAt: hoursAgo(5), design: { name: 'Agbada', category: 'agbada' } },
      { reference: 'Q2', status: 'pending', createdAt: hoursAgo(30) },
      { reference: 'Q3', status: 'submitted', createdAt: hoursAgo(50), submitted_at: hoursAgo(40), total: 80000, estimated_completion_days: 10 },
      { reference: 'Q4', status: 'accepted', createdAt: hoursAgo(200), submitted_at: hoursAgo(190), total: 120000, estimated_completion_days: 14 },
      { reference: 'Q5', status: 'declined', createdAt: hoursAgo(300), submitted_at: hoursAgo(280), total: 60000 },
      { reference: 'Q6', status: 'expired', createdAt: hoursAgo(400), submitted_at: hoursAgo(390), total: 40000 },
    ];
    const s = quoteStats(quotes, NOW);
    expect(s.waiting_for_you.map((w) => w.reference)).toEqual(['Q2', 'Q1']);
    expect(s.waiting_for_you[1]).toMatchObject({ design: 'Agbada', category: 'agbada', age_hours: 5 });
    expect(s.awaiting_customer).toBe(1);
    expect(s.decided).toBe(3);
    expect(s.win_rate).toBe('33%');
    expect(s.avg_quote_total).toBe(75000);
    expect(s.avg_accepted_total).toBe(120000);
    expect(s.avg_estimated_days).toBe(12);
    // 10h, 10h, 20h (declined), 10h (expired).
    expect(s.avg_hours_to_respond).toBe(12.5);
  });
});

describe('catalogueIssues', () => {
  it('lists what the storefront and the stylist cannot work without', () => {
    const bare = { kind: 'clothing', status: 'active', base_price: 0, clothing: { type: 'non_customize', images: [], description: 'Nice', color_variants: [] } };
    expect(catalogueIssues(bare, NOW, 0)).toEqual([
      'no_images', 'short_description', 'no_audience', 'no_colours', 'no_sizes', 'no_size_guide', 'no_price', 'no_views_30d',
    ]);
  });

  it('is quiet about a complete listing, and only flags stale drafts and sold-out stock when true', () => {
    const good = {
      kind: 'clothing', status: 'active', base_price: 25000, size_guide: new Types.ObjectId(), createdAt: hoursAgo(24 * 30),
      clothing: {
        type: 'non_customize',
        images: [{ url: 'a.jpg' }],
        description: 'A well described, generously long product description for the test.',
        taxonomy: { audience: 'women' },
        color_variants: [{ name: 'Red', variants: [{ size: 'M', stock: 3 }] }],
      },
    };
    expect(catalogueIssues(good, NOW, 12)).toEqual([]);

    const soldOut = { ...good, clothing: { ...good.clothing, color_variants: [{ name: 'Red', variants: [{ size: 'M', stock: 0 }] }] } };
    expect(catalogueIssues(soldOut, NOW, 12)).toEqual(['out_of_stock']);

    const freshDraft = { ...good, status: 'draft', createdAt: hoursAgo(24 * 3) };
    expect(catalogueIssues(freshDraft, NOW)).toEqual([]);
    const staleDraft = { ...good, status: 'draft', createdAt: hoursAgo(24 * 20) };
    expect(catalogueIssues(staleDraft, NOW)).toEqual(['stale_draft']);
  });

  it('judges fabric by its per-yard price and never asks it for sizes or a size guide', () => {
    const fabric = { kind: 'fabric', status: 'active', base_price: 0, fabric: { images: [{ url: 'f.jpg' }], description: 'Soft Ankara cotton, 45 inches wide, sold by the yard.', taxonomy: { audience: 'unisex' }, colors: [{ name: 'Teal' }], price_per_yard: 3500 } };
    expect(catalogueIssues(fabric, NOW, 3)).toEqual([]);
  });
});

describe('reviewStats', () => {
  it('aggregates ratings across products, with the worst first and the low comments to read', () => {
    const s = reviewStats([
      { name: 'Kaftan', ratings: [{ value: 5 }, { value: 4, comment: 'Lovely' }] },
      { name: 'Agbada', ratings: [{ value: 2, comment: 'Sleeves too tight' }, { value: 1, comment: '' }] },
      { name: 'Unrated', ratings: [] },
    ]);
    expect(s.rated_products).toBe(2);
    expect(s.total_ratings).toBe(4);
    expect(s.average).toBe(3);
    expect(s.distribution).toEqual({ '1': 1, '2': 1, '3': 0, '4': 1, '5': 1 });
    expect(s.lowest_rated[0]).toEqual({ product: 'Agbada', average: 1.5, ratings: 2 });
    expect(s.highest_rated[0].product).toBe('Kaftan');
    expect(s.recent_low_comments).toEqual([{ product: 'Agbada', rating: 2, comment: 'Sleeves too tight' }]);
  });
});
