import { Types } from 'mongoose';
import {
  daysLate,
  latePenaltyBase,
  latePenaltyTotal,
  latePreviewFor,
  lateRulesFrom,
  withLatePreview,
} from './late-penalty';

/**
 * The late-shipping rules shared by the penalty job, the 7-day cancellation
 * and the vendor app's preview (vendor deadline audit, ship-by column).
 */

const DAY = 86_400_000;
const store = new Types.ObjectId().toString();
const other = new Types.ObjectId().toString();
const rules = lateRulesFrom({}); // 5% a day, 25% cap, cancel after 7 days
const deadline = new Date('2026-11-18T12:00:00Z');

const order = (overrides: any = {}) => ({
  status: 'processing',
  items: [
    { business: store, total_price: 20_000 },
    { business: store, total_price: 5_000 },
    { business: store, total_price: 9_000, rejected: true },
    { business: other, total_price: 50_000 },
  ],
  shipments: [
    { business: store, confirmed: true, status: 'pending', fulfillment_deadline: deadline },
    { business: other, confirmed: true, status: 'shipped', fulfillment_deadline: deadline },
  ],
  ...overrides,
});

describe('late shipping rules', () => {
  it("are read from settings, with the platform's defaults", () => {
    expect(rules).toEqual({ perDayPercent: 5, maxPercent: 25, abandonAfterDays: 7 });
    expect(lateRulesFrom({ late_penalty_percent_per_day: 10, abandon_after_days: 0 })).toEqual({
      perDayPercent: 10,
      maxPercent: 25,
      abandonAfterDays: 0,
    });
  });

  it("charge only on the store's items still on the order", () => {
    expect(latePenaltyBase(order(), store)).toBe(25_000);
  });

  it('count a started day as a day', () => {
    expect(daysLate(deadline, deadline.getTime() - 1)).toBe(0);
    expect(daysLate(deadline, deadline.getTime() + 60_000)).toBe(1);
    expect(daysLate(deadline, deadline.getTime() + DAY + 1)).toBe(2);
  });

  it('cap the total', () => {
    expect(latePenaltyTotal(25_000, 1, rules)).toBe(1_250);
    expect(latePenaltyTotal(25_000, 3, rules)).toBe(3_750);
    expect(latePenaltyTotal(25_000, 9, rules)).toBe(6_250);
  });
});

describe('the preview a vendor sees', () => {
  it('before the deadline: what a late day costs, the most it can cost, and when it is cancelled', () => {
    const p = latePreviewFor(order(), order().shipments[0], rules, deadline.getTime() - DAY)!;
    expect(p.ship_by).toEqual(deadline);
    expect(p.per_day).toBe(1_250);
    expect(p.cap).toBe(6_250);
    expect(p.days_late).toBe(0);
    expect(p.cancel_on?.toISOString()).toBe('2026-11-25T12:00:00.000Z');
    expect(p.paused).toBe(false);
  });

  it('after it: days late and what has been charged', () => {
    const o = order();
    o.shipments[0] = { ...o.shipments[0], late_penalty_amount: 2_500 } as any;
    const p = latePreviewFor(o, o.shipments[0], rules, deadline.getTime() + DAY + 60_000)!;
    expect(p.days_late).toBe(2);
    expect(p.charged).toBe(2_500);
    // The job would charge exactly this by now.
    expect(latePenaltyTotal(latePenaltyBase(o, store), p.days_late, rules)).toBe(2_500);
  });

  it('none once shipped, unconfirmed, rejected, or the order is closed', () => {
    const o = order();
    expect(latePreviewFor(o, o.shipments[1], rules)).toBeNull();
    expect(latePreviewFor(o, { ...o.shipments[0], confirmed: false }, rules)).toBeNull();
    expect(latePreviewFor(o, { ...o.shipments[0], rejected: true }, rules)).toBeNull();
    expect(latePreviewFor({ ...o, status: 'cancelled' }, o.shipments[0], rules)).toBeNull();
  });

  it('paused while a bespoke order waits on the balance; no cancel date when switched off', () => {
    const o = order({ payment_plan: { status: 'awaiting_balance' } });
    const p = latePreviewFor(o, o.shipments[0], { ...rules, abandonAfterDays: 0 }, deadline.getTime() + 3 * DAY)!;
    expect(p.paused).toBe(true);
    expect(p.days_late).toBe(0);
    expect(p.cancel_on).toBeNull();
  });

  it("goes on the store's own shipments and at the top of the order", () => {
    const mine = withLatePreview(order(), store, rules, deadline.getTime() - DAY) as any;
    expect(mine.late_preview.per_day).toBe(1_250);
    expect(mine.shipments[0].late_preview).toBeDefined();
    expect(mine.shipments[1].late_preview).toBeUndefined();
    expect((withLatePreview(order(), other, rules) as any).late_preview).toBeNull();
  });
});
