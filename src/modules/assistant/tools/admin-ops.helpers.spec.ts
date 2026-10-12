import { Types } from 'mongoose';
import { searchGaps, stuckOrdersFrom, vendorHealth } from './admin-ops.helpers';

const NOW = new Date('2026-10-14T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const A = new Types.ObjectId();
const B = new Types.ObjectId();
const names: Record<string, string> = { [String(A)]: 'Ada Stitches', [String(B)]: 'Bisi Couture' };

const order = (over: any = {}) => ({
  reference: 'QLZ-1',
  status: 'processing',
  payment_status: 'paid',
  createdAt: hoursAgo(30),
  items: [{ business: A, total_price: 1000 }],
  shipments: [{ business: A, confirmed: false }],
  ...over,
});

describe('stuckOrdersFrom', () => {
  it('classifies each vendor shipment by why it stopped, worst first, and counts per vendor', () => {
    const orders = [
      order({ reference: 'UNCONF-30H' }), // unconfirmed for 30h: 6h over
      order({ reference: 'UNCONF-10H', createdAt: hoursAgo(10) }), // not yet stuck
      order({ reference: 'LATE', shipments: [{ business: A, confirmed: true, confirmed_at: hoursAgo(80), fulfillment_deadline: hoursAgo(8) }] }),
      order({ reference: 'TRANSIT', status: 'in_transit', shipments: [{ business: B, confirmed: true, shipped_at: hoursAgo(12 * 24) }] }),
      order({ reference: 'PRESHIP', order_type: 'bespoke', preship: { status: 'pending_review', submitted_at: hoursAgo(60) }, shipments: [{ business: B, confirmed: true }] }),
      order({ reference: 'UNPAID', status: 'pending', createdAt: hoursAgo(100) }),
      order({ reference: 'MULTI', createdAt: hoursAgo(50), shipments: [{ business: A, confirmed: false }, { business: B, confirmed: false }] }),
    ];
    const r = stuckOrdersFrom(orders, NOW, (id) => names[id] ?? id);

    expect(r.unconfirmed.map((o) => o.reference)).toEqual(['MULTI', 'MULTI', 'UNCONF-30H']);
    expect(r.unconfirmed[2]).toMatchObject({ vendor: 'Ada Stitches', reason: 'unconfirmed', hours_over: 6 });
    expect(r.past_deadline.map((o) => o.reference)).toEqual(['LATE']);
    expect(r.past_deadline[0].hours_over).toBe(8);
    expect(r.in_transit_too_long[0]).toMatchObject({ reference: 'TRANSIT', vendor: 'Bisi Couture', hours_over: 48 });
    expect(r.preship_waiting_on_customer[0]).toMatchObject({ reference: 'PRESHIP', hours_over: 12 });
    expect(r.total).toBe(6);
    expect(r.by_vendor).toEqual([
      { vendor: 'Ada Stitches', stuck: 3 },
      { vendor: 'Bisi Couture', stuck: 3 },
    ]);
  });

  it('is empty when nothing is stuck', () => {
    const r = stuckOrdersFrom([order({ createdAt: hoursAgo(2) })], NOW);
    expect(r.total).toBe(0);
    expect(r.by_vendor).toEqual([]);
  });
});

describe('vendorHealth', () => {
  const v = (over: any) => ({
    business_id: String(new Types.ObjectId()),
    name: 'V',
    orders: 20,
    shipped: 20,
    late: 0,
    cancelled: 0,
    disputes: 0,
    returns: 0,
    rating: 4.5,
    rating_count: 10,
    ...over,
  });

  it('computes rates, medians over assessed vendors, and flags the breaches by name', () => {
    const r = vendorHealth([
      v({ name: 'Good' }),
      v({ name: 'Late', late: 6 }), // 30% late
      v({ name: 'Disputed', disputes: 2, cancelled: 3, rating: 3.1 }), // 10% disputes, 15% cancelled, low rating
      v({ name: 'Tiny', orders: 1, shipped: 1, late: 1 }), // not assessed
    ]);

    expect(r.vendors_assessed).toBe(3);
    expect(r.medians.late_rate).toBe(0);
    expect(r.flagged.map((f) => f.name)).toEqual(['Disputed', 'Late']);
    expect(r.flagged[0].flags).toEqual(['15% of orders cancelled', 'disputes on 10% of orders', 'rated 3.1/5']);
    expect(r.flagged[1].flags).toEqual(['late on 30% of shipments']);
    const tiny = r.rows.find((x) => x.name === 'Tiny')!;
    expect(tiny.late_rate).toBe(100);
    expect(tiny.flags).toEqual([]);
  });

  it('returns null rates, not NaN, when there is nothing to divide by', () => {
    const r = vendorHealth([v({ orders: 0, shipped: 0, rating: null, rating_count: 0 })]);
    expect(r.rows[0].late_rate).toBeNull();
    expect(r.rows[0].dispute_rate).toBeNull();
    expect(r.medians.rating).toBeNull();
  });
});

describe('searchGaps', () => {
  it('groups terms case-insensitively, judges only events that recorded a count, and lists the unmet demand first', () => {
    const r = searchGaps([
      { query: 'Agbada', results: 12, at: '2026-10-10T10:00:00Z' },
      { query: 'agbada ', results: 9, at: '2026-10-11T10:00:00Z' },
      { query: 'Senator wear', results: 0, at: '2026-10-10T10:00:00Z' },
      { query: 'senator  wear', results: 0, at: '2026-10-12T10:00:00Z' },
      { query: 'senator wear', at: '2026-10-13T10:00:00Z' }, // old event, no count
      { query: 'boubou', results: 0, at: '2026-10-12T10:00:00Z' }, // searched once: not a gap yet
      { query: '', results: 0, at: '2026-10-12T10:00:00Z' },
    ]);
    expect(r.terms).toBe(3);
    expect(r.gaps.map((g) => g.term)).toEqual(['senator wear']);
    expect(r.gaps[0]).toMatchObject({ searches: 3, judged: 2, zero_results: 2, zero_share: 100, last_searched_at: '2026-10-13T10:00:00.000Z' });
    expect(r.top[0]).toMatchObject({ term: 'senator wear', searches: 3 });
    expect(r.top.find((t) => t.term === 'agbada')?.zero_share).toBe(0);
  });
});
