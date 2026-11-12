import { Types } from 'mongoose';
import {
  confirmByFor,
  confirmHoursFrom,
  confirmWarningLeadHours,
  withConfirmBy,
} from './confirm-deadline';
import { OrderService } from './orders.service';

/**
 * The confirm-by time the vendor app counts down to, and the warning sent
 * before an unconfirmed order cancels itself (vendor deadline audit, item 1).
 */

const HOUR = 3_600_000;
const store = new Types.ObjectId().toString();
const otherStore = new Types.ObjectId().toString();
const paidAt = new Date('2026-11-12T09:00:00Z');

const order = (overrides: any = {}) => ({
  status: 'in_review',
  createdAt: new Date('2026-11-12T08:30:00Z'),
  paid_at: paidAt,
  shipments: [
    { _id: 's1', business: store, confirmed: false },
    { _id: 's2', business: otherStore, confirmed: true },
  ],
  ...overrides,
});

describe('confirm-by time', () => {
  it('counts from payment', () => {
    const by = confirmByFor(order(), order().shipments[0], 48);
    expect(by?.toISOString()).toBe('2026-11-14T09:00:00.000Z');
  });

  it('counts from creation for orders paid before paid_at existed', () => {
    const o = order({ paid_at: null });
    expect(confirmByFor(o, o.shipments[0], 24)?.toISOString()).toBe('2026-11-13T08:30:00.000Z');
  });

  it('has none once confirmed, rejected, past review, or with auto-cancel off', () => {
    const o = order();
    expect(confirmByFor(o, o.shipments[1], 24)).toBeNull();
    expect(confirmByFor(o, { ...o.shipments[0], rejected: true }, 24)).toBeNull();
    expect(confirmByFor({ ...o, status: 'processing' }, o.shipments[0], 24)).toBeNull();
    expect(confirmByFor(o, o.shipments[0], 0)).toBeNull();
  });

  it("adds it to the vendor's order: per shipment, and their own at the top", () => {
    const mine = withConfirmBy(order(), store, 24) as any;
    expect(mine.confirm_by.toISOString()).toBe('2026-11-13T09:00:00.000Z');
    expect(mine.shipments[0].confirm_by).toBeInstanceOf(Date);
    expect(mine.shipments[1].confirm_by).toBeUndefined();
    // The other store already confirmed, so nothing is pending for them.
    expect((withConfirmBy(order(), otherStore, 24) as any).confirm_by).toBeNull();
  });

  it('reads the setting, defaulting to 24', () => {
    expect(confirmHoursFrom({ auto_reject_hours: 48 })).toBe(48);
    expect(confirmHoursFrom({})).toBe(24);
    expect(confirmHoursFrom({ auto_reject_hours: 0 })).toBe(0);
  });

  it('warns 4 hours ahead, or a quarter of a short window', () => {
    expect(confirmWarningLeadHours(48)).toBe(4);
    expect(confirmWarningLeadHours(24)).toBe(4);
    expect(confirmWarningLeadHours(0.1)).toBeCloseTo(0.025);
  });
});

describe('warning before an unconfirmed order cancels itself', () => {
  const setup = (rows: any[], hours = 48, claimed = 1) => {
    const service: any = Object.create(OrderService.prototype);
    const find = jest.fn((_filter: any) => ({ lean: async () => rows }));
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: claimed });
    const create = jest.fn().mockResolvedValue({});
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ auto_reject_hours: hours }) }) },
      orderModel: { find, updateOne },
      vendorRecipients: { resolve: async () => [{ userId: 'owner' }, { userId: 'ops' }] },
      notificationsService: { create },
    });
    return { service, find, updateOne, create };
  };

  const dueSoon = () => ({
    _id: new Types.ObjectId(),
    reference: 'ORD-77',
    status: 'in_review',
    paid_at: new Date(Date.now() - 45 * HOUR), // 3 hours left of 48
    shipments: [
      { _id: new Types.ObjectId(), business: store, confirmed: false, confirm_warning_sent_at: null },
      { _id: new Types.ObjectId(), business: otherStore, confirmed: true },
    ],
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("tells the store's team once, naming the time", async () => {
    const { service, create, updateOne } = setup([dueSoon()]);
    await service.warnUnconfirmedShipments();
    await flush();
    expect(updateOne).toHaveBeenCalledTimes(1); // only the unconfirmed shipment
    expect(create).toHaveBeenCalledTimes(2); // owner + operations
    const notice = create.mock.calls[0][0];
    expect(notice.recipient_business).toBe(store);
    expect(notice.title).toBe('Confirm this order soon');
    expect(notice.body).toContain('ORD-77');
  });

  it('looks only at orders inside the warning window', async () => {
    const { service, find } = setup([], 48);
    await service.warnUnconfirmedShipments();
    const filter = find.mock.calls[0][0];
    const paid = filter.$or[0].paid_at;
    expect(Date.now() - paid.$lte.getTime()).toBeCloseTo(44 * HOUR, -4);
    expect(Date.now() - paid.$gt.getTime()).toBeCloseTo(48 * HOUR, -4);
  });

  it('says nothing when another run already claimed it', async () => {
    const { service, create } = setup([dueSoon()], 48, 0);
    await service.warnUnconfirmedShipments();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('does nothing when auto-cancel is off', async () => {
    const { service, find } = setup([dueSoon()], 0);
    await service.warnUnconfirmedShipments();
    expect(find).not.toHaveBeenCalled();
  });
});
