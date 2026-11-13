import { Types } from 'mongoose';
import { cancelWarningDue, lateRulesFrom, shipByWarningDue } from './late-penalty';
import { OrderService } from './orders.service';

/**
 * Warnings before the two late-shipping deadlines (vendor deadline audit):
 * a reminder before the ship-by date, and a warning before the order is
 * cancelled for not shipping.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const store = new Types.ObjectId().toString();
const rules = lateRulesFrom({}); // 5% a day, up to 25%, cancelled 7 days late
const deadline = new Date('2026-11-18T12:00:00Z');
const at = deadline.getTime();

const shipment = (o: any = {}) => ({
  _id: new Types.ObjectId(),
  business: store,
  confirmed: true,
  confirmed_at: new Date(at - 5 * DAY),
  status: 'pending',
  fulfillment_deadline: deadline,
  ship_by_warning_for: null,
  cancel_warning_for: null,
  ...o,
});
const order = (s: any = shipment(), o: any = {}) => ({
  _id: new Types.ObjectId(),
  reference: 'ORD-88',
  status: 'processing',
  items: [{ business: store, total_price: 25_000 }],
  shipments: [s],
  ...o,
});

describe('reminder before the ship-by date', () => {
  it('in the last 24 hours, not before and not after', () => {
    const s = shipment();
    expect(shipByWarningDue(order(s), s, at - 25 * HOUR)).toBeNull();
    expect(shipByWarningDue(order(s), s, at - 23 * HOUR)?.getTime()).toBe(at);
    expect(shipByWarningDue(order(s), s, at + 1)).toBeNull();
  });

  it('once per date; a deadline moved later gets its own', () => {
    const sent = shipment({ ship_by_warning_for: deadline });
    expect(shipByWarningDue(order(sent), sent, at - HOUR)).toBeNull();
    const later = new Date(at + 3 * DAY);
    const moved = shipment({ ship_by_warning_for: deadline, fulfillment_deadline: later });
    expect(shipByWarningDue(order(moved), moved, later.getTime() - HOUR)?.getTime()).toBe(
      later.getTime(),
    );
  });

  it('half of a short window, so it does not land the moment they confirm', () => {
    const s = shipment({ confirmed_at: new Date(at - 12 * HOUR) });
    expect(shipByWarningDue(order(s), s, at - 11 * HOUR)).toBeNull();
    expect(shipByWarningDue(order(s), s, at - 5 * HOUR)).not.toBeNull();
  });

  it('nothing once shipped, rejected, or waiting on a bespoke balance', () => {
    const now = at - HOUR;
    const shipped = shipment({ status: 'shipped' });
    expect(shipByWarningDue(order(shipped), shipped, now)).toBeNull();
    const rejected = shipment({ rejected: true });
    expect(shipByWarningDue(order(rejected), rejected, now)).toBeNull();
    const s = shipment();
    expect(
      shipByWarningDue(order(s, { payment_plan: { status: 'awaiting_balance' } }), s, now),
    ).toBeNull();
  });
});

describe('warning before the order is cancelled', () => {
  const cancelOn = at + 7 * DAY;

  it('in the last 2 days before it', () => {
    const s = shipment();
    expect(cancelWarningDue(order(s), s, rules, cancelOn - 3 * DAY)).toBeNull();
    expect(cancelWarningDue(order(s), s, rules, cancelOn - DAY)?.getTime()).toBe(cancelOn);
    expect(cancelWarningDue(order(s), s, rules, cancelOn + 1)).toBeNull();
  });

  it('once, never for fabric transfers, and not when cancellation is off', () => {
    const now = cancelOn - DAY;
    const sent = shipment({ cancel_warning_for: new Date(cancelOn) });
    expect(cancelWarningDue(order(sent), sent, rules, now)).toBeNull();
    const fabric = shipment({ shipment_type: 'fabric_transfer' });
    expect(cancelWarningDue(order(fabric), fabric, rules, now)).toBeNull();
    const s = shipment();
    expect(cancelWarningDue(order(s), s, { ...rules, abandonAfterDays: 0 }, now)).toBeNull();
  });

  it('half the stage when it is shorter than 2 days', () => {
    const short = { ...rules, abandonAfterDays: 1 };
    const s = shipment();
    expect(cancelWarningDue(order(s), s, short, at + 6 * HOUR)).toBeNull();
    expect(cancelWarningDue(order(s), s, short, at + 13 * HOUR)).not.toBeNull();
  });
});

describe('the hourly job', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const setup = (rows: any[], claimed = 1) => {
    const service: any = Object.create(OrderService.prototype);
    const find = jest.fn((_filter: any) => ({ lean: async () => rows }));
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: claimed });
    const create = jest.fn().mockResolvedValue({});
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({}) }) },
      orderModel: { find, updateOne },
      vendorRecipients: { resolve: async () => [{ userId: 'owner' }] },
      notificationsService: { create },
    });
    return { service, find, updateOne, create };
  };

  afterEach(() => jest.useRealTimers());

  it('reminds the store before the ship-by date, with the cost', async () => {
    jest.useFakeTimers({ now: at - 6 * HOUR, doNotFake: ['setTimeout'] });
    const { service, create, updateOne } = setup([order()]);
    await service.warnBeforeShipDeadlines();
    await flush();
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][1].$set['shipments.$.ship_by_warning_for']).toEqual(deadline);
    const notice = create.mock.calls[0][0];
    expect(notice.recipient_business).toBe(store);
    expect(notice.title).toBe('This order is due to ship soon');
    expect(notice.body).toContain('ORD-88');
    expect(notice.body).toContain('₦1,250 from your earnings, up to ₦6,250');
  });

  it('warns before cancelling, with what has been charged', async () => {
    jest.useFakeTimers({ now: at + 6 * DAY, doNotFake: ['setTimeout'] });
    const late = shipment({ late_penalty_amount: 6_250 });
    const { service, create, updateOne } = setup([order(late)]);
    await service.warnBeforeShipDeadlines();
    await flush();
    expect(updateOne).toHaveBeenCalledTimes(1);
    const notice = create.mock.calls[0][0];
    expect(notice.title).toBe('This order will be cancelled soon');
    expect(notice.body).toMatch(/cancelled, the customer refunded in full/);
    expect(notice.body).toContain('₦6,250 has been taken');
  });

  it('says nothing when another run already claimed it', async () => {
    jest.useFakeTimers({ now: at - 6 * HOUR, doNotFake: ['setTimeout'] });
    const { service, create } = setup([order()], 0);
    await service.warnBeforeShipDeadlines();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('looks at deadlines up to 24 hours ahead, reaching back past the cancel window', async () => {
    jest.useFakeTimers({ now: at, doNotFake: ['setTimeout'] });
    const { service, find } = setup([]);
    await service.warnBeforeShipDeadlines();
    const range = find.mock.calls[0][0].shipments.$elemMatch.fulfillment_deadline;
    // 7 days of the cancel window plus 60: a clock can hold a vendor to a
    // date later than the stored one (fabric arrived late, a measurement answer).
    expect(at - range.$gt.getTime()).toBe((7 + 60) * DAY);
    expect(range.$lte.getTime() - at).toBe(24 * HOUR);
  });
});
