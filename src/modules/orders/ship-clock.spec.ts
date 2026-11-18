import { Types } from 'mongoose';
import {
  MEASUREMENT_PAUSE_DAYS,
  latePreviewFor,
  lateRulesFrom,
  shipByWarningDue,
  shipClock,
} from './late-penalty';
import { OrderService } from './orders.service';

/**
 * Who owns each clock (bespoke review, 13 Nov 2026): a tailor is not held
 * to time they spend waiting on someone else.
 * - Fabric from another shop on its way: the tailor's clock is paused, and
 *   their making time starts when it arrives.
 * - A measurement question: the customer's answer time, up to 3 days, is
 *   added to the tailor's date.
 * - Fabric that never arrives: the order closes as the fabric shop's failure.
 */

const DAY = 86_400_000;
const tailor = new Types.ObjectId().toString();
const fabricShop = new Types.ObjectId().toString();
const paid = new Date('2026-11-01T10:00:00Z').getTime();
const rules = lateRulesFrom({});

const garment = (o: any = {}) => ({
  _id: new Types.ObjectId(),
  business: new Types.ObjectId(tailor),
  shipment_type: 'vendor_to_customer',
  confirmed: true,
  confirmed_at: new Date(paid),
  making_days: 10,
  fulfillment_deadline: new Date(paid + 10 * DAY),
  status: 'pending',
  ...o,
});
const transfer = (o: any = {}) => ({
  _id: new Types.ObjectId(),
  business: new Types.ObjectId(fabricShop),
  destination_business: new Types.ObjectId(tailor),
  shipment_type: 'fabric_transfer',
  confirmed: true,
  fulfillment_deadline: new Date(paid + 3 * DAY),
  status: 'pending',
  ...o,
});
const order = (shipments: any[], o: any = {}) => ({
  _id: new Types.ObjectId(),
  reference: 'BSP-9',
  type: 'bespoke',
  status: 'processing',
  customer: new Types.ObjectId(),
  items: [{ _id: new Types.ObjectId(), business: new Types.ObjectId(tailor), total_price: 50_000 }],
  shipments,
  ...o,
});

describe('fabric from another shop', () => {
  it("the tailor's clock waits until it arrives", () => {
    const g = garment();
    const clock = shipClock(order([g, transfer()]), g, paid + 12 * DAY);
    expect(clock.paused).toBe('fabric');
    expect(clock.deadline).toBeNull();
    expect(clock.fabric_due?.getTime()).toBe(paid + 3 * DAY);
  });

  it('arriving late restarts the full making time from the arrival', () => {
    const g = garment();
    const arrived = paid + 6 * DAY;
    const o = order([g, transfer({ status: 'delivered', delivered_at: new Date(arrived) })]);
    expect(shipClock(o, g, arrived + DAY).deadline?.getTime()).toBe(arrived + 10 * DAY);
  });

  it('arriving early never shortens the date', () => {
    const g = garment();
    const o = order([g, transfer({ status: 'delivered', delivered_at: new Date(paid - DAY) })]);
    expect(shipClock(o, g, paid).deadline?.getTime()).toBe(paid + 10 * DAY);
  });

  it('the fabric shop runs on its own date', () => {
    const t = transfer();
    expect(shipClock(order([garment(), t]), t, paid).deadline?.getTime()).toBe(paid + 3 * DAY);
  });

  it('no late charge, warning or cancel date for the tailor while waiting', () => {
    const g = garment();
    const o = order([g, transfer()]);
    const preview = latePreviewFor(o, g, rules, paid + 12 * DAY)!;
    expect(preview.paused).toBe(true);
    expect(preview.paused_reason).toBe('fabric');
    expect(preview.days_late).toBe(0);
    expect(preview.cancel_on).toBeNull();
    expect(shipByWarningDue(o, g, paid + 9.5 * DAY)).toBeNull();
  });
});

describe('measurement questions', () => {
  const question = (asked: number, answered: number | null) => ({
    business: new Types.ObjectId(tailor),
    asked_at: new Date(asked),
    answered_at: answered === null ? null : new Date(answered),
    status: answered === null ? 'open' : 'answered',
  });

  it("adds the customer's answer time to the tailor's date", () => {
    const g = garment();
    const o = order([g], { measurement_questions: [question(paid + DAY, paid + 2 * DAY)] });
    expect(shipClock(o, g, paid + 5 * DAY).deadline?.getTime()).toBe(paid + 11 * DAY);
  });

  it(`at most ${MEASUREMENT_PAUSE_DAYS} days, however long the answer takes`, () => {
    const g = garment();
    const o = order([g], { measurement_questions: [question(paid + DAY, paid + 8 * DAY)] });
    expect(shipClock(o, g, paid + 9 * DAY).deadline?.getTime()).toBe(paid + 13 * DAY);
  });

  it('while unanswered the clock is held, then runs again after the cap', () => {
    const g = garment();
    const o = order([g], { measurement_questions: [question(paid + 9 * DAY, null)] });
    const waiting = shipClock(o, g, paid + 10.5 * DAY);
    expect(waiting.paused).toBe('measurements');
    expect(waiting.deadline!.getTime()).toBeGreaterThan(paid + 10.5 * DAY);
    const after = shipClock(o, g, paid + 13 * DAY);
    expect(after.paused).toBeNull();
    expect(after.deadline?.getTime()).toBe(paid + 13 * DAY);
  });

  it('a question asked after the date has passed buys nothing', () => {
    const g = garment();
    const o = order([g], { measurement_questions: [question(paid + 11 * DAY, paid + 12 * DAY)] });
    expect(shipClock(o, g, paid + 12 * DAY).deadline?.getTime()).toBe(paid + 10 * DAY);
  });

  it("another vendor's question does not move this one", () => {
    const g = garment();
    const q = { ...question(paid + DAY, paid + 2 * DAY), business: new Types.ObjectId() };
    expect(shipClock(order([g], { measurement_questions: [q] }), g, paid).deadline?.getTime()).toBe(
      paid + 10 * DAY,
    );
  });
});

describe('the jobs follow the clock', () => {
  const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const service = (o: any) => {
    const svc: any = Object.create(OrderService.prototype);
    const processPartialRefund = jest.fn().mockResolvedValue({ success: true });
    const create = jest.fn().mockResolvedValue({});
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    Object.assign(svc, {
      logger: quiet,
      processPartialRefund,
      reverseBusinessEarnings: jest.fn().mockResolvedValue(undefined),
      settleReleasedFabric: jest.fn().mockResolvedValue(undefined),
      releaseFabricForCancelledGarment: () => ({ goods: 0, shipping: 0, released: [] }),
      productService: { restoreInventory: jest.fn().mockResolvedValue(undefined) },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ abandon_after_days: 7 }) }) },
      orderModel: { find: async () => [o], updateOne },
      businessModel: {
        findById: (id: any) => {
          const name = String(id) === fabricShop ? 'Ada Fabrics' : 'Tunde Tailors';
          const doc: any = { business_name: name };
          return Object.assign(Promise.resolve(doc), {
            select: () => ({ lean: async () => doc }),
          });
        },
      },
      notificationsService: { create },
      vendorRecipients: { resolve: async () => [{ userId: 'owner' }] },
    });
    return { svc, processPartialRefund, create, updateOne };
  };

  afterEach(() => jest.useRealTimers());

  it('no late charge while the fabric is on its way', async () => {
    jest.useFakeTimers({ now: paid + 12 * DAY, doNotFake: ['setTimeout'] });
    const g = garment();
    const o: any = order([g, transfer()]);
    o.save = jest.fn();
    const { svc, updateOne } = service(o);
    await svc.checkLateFulfillments();
    const tailorCharged = updateOne.mock.calls.some(
      (c: any[]) => String(c[0]?.shipments?.$elemMatch?._id) === String(g._id),
    );
    expect(tailorCharged).toBe(false);
  });

  it('fabric that never arrives closes the order as the fabric shop’s failure', async () => {
    jest.useFakeTimers({ now: paid + 11 * DAY, doNotFake: ['setTimeout'] });
    const g = garment();
    const o: any = order([g, transfer()]);
    o.markModified = () => undefined;
    o.save = jest.fn();
    const { svc, processPartialRefund, create } = service(o);
    await svc.cancelAbandonedShipments();
    expect(processPartialRefund).toHaveBeenCalledTimes(1);
    expect(processPartialRefund.mock.calls[0][2]).toMatch(/Ada Fabrics did not send the fabric/);
    const toCustomer = create.mock.calls.find((c: any[]) => c[0].audience === 'customer')[0];
    expect(toCustomer.body).toMatch(/Ada Fabrics did not send the fabric/);
    const toTailor = create.mock.calls.find((c: any[]) => c[0].recipient_business === tailor)[0];
    expect(toTailor.title).toBe('Order Cancelled - Fabric Never Arrived');
    expect(toTailor.body).toMatch(/not charged for lateness/);
  });

  it('before the fabric shop is 7 days late, nothing is cancelled', async () => {
    jest.useFakeTimers({ now: paid + 9 * DAY, doNotFake: ['setTimeout'] });
    const o: any = order([garment(), transfer()]);
    o.save = jest.fn();
    const { svc, processPartialRefund } = service(o);
    await svc.cancelAbandonedShipments();
    expect(processPartialRefund).not.toHaveBeenCalled();
  });
});
