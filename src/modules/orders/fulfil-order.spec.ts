import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { ShipmentStatus, ShipmentType } from './schemas/orders.schema';

/**
 * What happens when a vendor fulfils their part of an order: every refusal
 * leaves the part at 'pending' (never parked at 'ready_to_ship' with no
 * courier), a rejected part never holds the order back, the courier is
 * booked for the right pickup day, the customer hears it's booked, and a
 * collection that went wrong can be rebooked and gets flagged.
 */

const store = new Types.ObjectId().toString();
const otherStore = new Types.ObjectId().toString();
const fabricStore = new Types.ObjectId().toString();
const customer = new Types.ObjectId().toString();

// Tuesday 24 November 2026, 10:00 in Lagos.
const NOW = new Date('2026-11-24T09:00:00Z');

const myShipment = (over: any = {}) => ({
  _id: 's-mine',
  business: store,
  confirmed: true,
  status: ShipmentStatus.PENDING,
  shipment_type: ShipmentType.VENDOR_TO_CUSTOMER,
  request_token: 'tok',
  courier_id: 'c1',
  service_code: 'SB-STD',
  rate_fetched_at: new Date(NOW.getTime() - 5 * 60 * 1000),
  ...over,
});

const orderDoc = (shipments: any[]) => ({
  id: 'o1',
  _id: 'o1',
  reference: 'ORD-1',
  type: 'standard',
  status: 'processing',
  customer,
  address: { address_code: 1 },
  items: [],
  shipments,
  save: jest.fn().mockResolvedValue(undefined),
});

const setup = (
  shipments: any[],
  opts: { paid?: boolean; label?: () => Promise<any>; cancel?: () => Promise<any> } = {},
) => {
  const service: any = Object.create(OrderService.prototype);
  const pre = orderDoc(shipments.map((s) => ({ ...s })));
  const claimed = orderDoc(shipments.map((s) => ({ ...s })));
  // Claims only when the filter's status matches the part's real status,
  // like Mongo would.
  const findOneAndUpdate = jest.fn(async (filter: any) => {
    const want = filter.shipments.$elemMatch.status;
    const mine = pre.shipments.find((s: any) => s.business === store);
    const ok = want?.$in ? want.$in.includes(mine?.status) : want === mine?.status;
    return ok ? claimed : null;
  });
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const create = jest.fn().mockResolvedValue({});
  const createShipmentFromToken = jest.fn(
    opts.label ??
      (async () => ({
        order_id: 'SB-2',
        courier: { tracking_code: 'TRK-2', name: 'Kwik' },
        tracking_url: 'https://track.example/TRK-2',
      })),
  );
  const fetchRates = jest.fn(async () => ({
    request_token: 'tok-fresh',
    couriers: [{ courier_id: 'c1', service_code: 'SB-STD' }],
    cheapest_courier: { courier_id: 'c9', service_code: 'SB-CHEAP' },
  }));
  const cancelShipment = jest.fn(opts.cancel ?? (async () => ({ status: 'success' })));
  Object.assign(service, {
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    orderModel: { findOne: jest.fn().mockResolvedValue(pre), findOneAndUpdate, updateOne },
    businessModel: { find: jest.fn().mockResolvedValue([{ business_name: 'Ada Fabrics' }]) },
    transactionService: {
      findByOrderId: jest.fn().mockResolvedValue({ status: opts.paid === false ? 'pending' : 'success' }),
    },
    logisticService: { createShipmentFromToken, fetchRates, cancelShipment },
    notificationsService: { create },
    assertOrderPaid: jest.fn().mockResolvedValue(undefined),
  });
  const business = { _id: store, business_name: 'Tola Studio', address_code: 2 };
  const fulfil = () => service.fulfillVendorShipment('ORD-1', business, {});
  return { fulfil, claimed, findOneAndUpdate, updateOne, create, createShipmentFromToken, fetchRates, cancelShipment };
};

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('vendor fulfils their part of an order', () => {
  it('books the courier, marks the part shipped and tells the customer', async () => {
    const t = setup([myShipment()]);
    const res = await t.fulfil();
    await flush();

    expect(res.data.order_status).toBe('in_transit');
    const s = t.claimed.shipments[0] as any;
    expect(s.status).toBe(ShipmentStatus.SHIPPED);
    expect(s.tracking_number).toBe('TRK-2');
    expect(s.pickup_date).toBe('2026-11-24');
    expect(s.tracking_events.map((e: any) => e.status)).toEqual(['booked']);
    // A fresh quote for today's pickup is used as is.
    expect(t.fetchRates).not.toHaveBeenCalled();

    expect(t.create).toHaveBeenCalledTimes(1);
    const note = t.create.mock.calls[0][0];
    expect(note.recipient).toBe(customer);
    expect(note.audience).toBe('customer');
    expect(note.title).toBe('Courier booked');
    expect(note.body).toBe(
      "Tola Studio has packed your order #ORD-1 and booked a courier to collect it today. We'll tell you when it's picked up.",
    );
    expect(note.metadata).toMatchObject({
      stage: 'booked',
      pickup_date: '2026-11-24',
      tracking_url: 'https://track.example/TRK-2',
    });
    expect(note.action_url).toBe('/profile?tab=orders&order=ORD-1&view=track');
  });

  it('books the next working day after the cut-off, with a fresh quote for that day', async () => {
    jest.setSystemTime(new Date('2026-11-27T17:30:00Z')); // Friday 18:30 Lagos
    const t = setup([myShipment({ rate_fetched_at: new Date('2026-11-27T17:20:00Z') })]);
    await t.fulfil();
    await flush();

    expect(t.fetchRates).toHaveBeenCalledTimes(1);
    expect((t.fetchRates.mock.calls[0] as any[])[1].pickup_date).toBe('2026-11-30');
    expect((t.claimed.shipments[0] as any).pickup_date).toBe('2026-11-30');
    expect(t.create.mock.calls[0][0].body).toContain('to collect it on Monday 30 November');
  });

  it('refuses while fabric from another store is on its way, before claiming the part', async () => {
    const t = setup([
      myShipment(),
      {
        business: fabricStore,
        shipment_type: ShipmentType.FABRIC_TRANSFER,
        destination_business: store,
        status: ShipmentStatus.IN_TRANSIT,
      },
    ]);
    await expect(t.fulfil()).rejects.toThrow(/waiting for fabric delivery from Ada Fabrics/);
    expect(t.findOneAndUpdate).not.toHaveBeenCalled();
    expect(t.createShipmentFromToken).not.toHaveBeenCalled();
  });

  it('refuses an order without a successful payment, before claiming the part', async () => {
    const t = setup([myShipment()], { paid: false });
    await expect(t.fulfil()).rejects.toThrow(/payment not completed/);
    expect(t.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('puts the part back to pending when shipping data is missing', async () => {
    const t = setup([myShipment({ service_code: null })]);
    await expect(t.fulfil()).rejects.toThrow(/Missing shipping data/);
    expect(t.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ORD-1' }),
      { $set: { 'shipments.$.status': ShipmentStatus.PENDING } },
    );
    expect(t.create).not.toHaveBeenCalled();
  });

  it('puts the part back to pending when the courier booking fails', async () => {
    const t = setup([myShipment()], {
      label: async () => {
        throw new Error('Insufficient balance');
      },
    });
    await expect(t.fulfil()).rejects.toThrow('Insufficient balance');
    expect(t.updateOne).toHaveBeenCalledTimes(1);
    expect(t.claimed.save).not.toHaveBeenCalled();
    expect(t.create).not.toHaveBeenCalled();
  });

  it("doesn't let another store's rejected part hold the order back", async () => {
    const t = setup([
      myShipment(),
      { business: otherStore, rejected: true, status: ShipmentStatus.PENDING },
    ]);
    const res = await t.fulfil();
    expect(res.data.order_status).toBe('in_transit');
  });

  it('leaves the order in processing while another store still has to ship', async () => {
    const t = setup([
      myShipment(),
      { business: otherStore, confirmed: true, status: ShipmentStatus.PENDING },
    ]);
    const res = await t.fulfil();
    expect(res.data.order_status).toBe('processing');
  });

  it('refuses a second booking of a part already on its way to the courier', async () => {
    const t = setup([myShipment({ status: ShipmentStatus.SHIPPED, shipment_id: 'SB-1' })]);
    await expect(t.fulfil()).rejects.toThrow(/already shipped/);
    expect(t.cancelShipment).not.toHaveBeenCalled();
    expect(t.createShipmentFromToken).not.toHaveBeenCalled();
  });
});

describe('rebooking a collection that went wrong', () => {
  it('books a new courier after the courier cancelled, with a fresh quote', async () => {
    const t = setup([myShipment({ status: ShipmentStatus.FAILED, shipment_id: 'SB-1' })]);
    await t.fulfil();
    await flush();

    // A cancelled booking is already off the courier's list.
    expect(t.cancelShipment).not.toHaveBeenCalled();
    expect(t.fetchRates).toHaveBeenCalledTimes(1);
    const [filter, update] = t.findOneAndUpdate.mock.calls[0] as any[];
    expect(filter.shipments.$elemMatch).toEqual({ business: store, status: ShipmentStatus.FAILED });
    expect(update.$set['shipments.$.pickup_alerted_at']).toBeNull();
    expect(update.$inc).toEqual({ 'shipments.$.rebook_count': 1 });

    const s = t.claimed.shipments[0] as any;
    expect(s.status).toBe(ShipmentStatus.SHIPPED);
    expect(s.shipment_id).toBe('SB-2');
    expect(s.tracking_events.map((e: any) => e.status)).toEqual(['rebooked']);
    expect(t.create.mock.calls[0][0].title).toBe('New courier booked');
  });

  it('cancels the uncollected booking first, so two couriers never come', async () => {
    const t = setup([
      myShipment({ status: ShipmentStatus.SHIPPED, shipment_id: 'SB-1', pickup_alerted_at: new Date() }),
    ]);
    await t.fulfil();
    expect(t.cancelShipment).toHaveBeenCalledWith('SB-1');
    expect(t.cancelShipment.mock.invocationCallOrder[0]).toBeLessThan(
      t.createShipmentFromToken.mock.invocationCallOrder[0],
    );
  });

  it("books nothing when the first booking can't be cancelled", async () => {
    const t = setup(
      [myShipment({ status: ShipmentStatus.SHIPPED, shipment_id: 'SB-1', pickup_alerted_at: new Date() })],
      {
        cancel: async () => {
          throw new Error('Shipment already picked up');
        },
      },
    );
    await expect(t.fulfil()).rejects.toThrow(/couldn't cancel the first courier booking/);
    expect(t.findOneAndUpdate).not.toHaveBeenCalled();
    expect(t.createShipmentFromToken).not.toHaveBeenCalled();
  });
});

describe('hourly check for collections that went wrong', () => {
  const run = (shipments: any[], claimed = 1) => {
    const service: any = Object.create(OrderService.prototype);
    const order = { _id: 'o1', reference: 'ORD-1', status: 'processing', shipments };
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: claimed });
    const create = jest.fn().mockResolvedValue({});
    const notifyPlatformAdmins = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      orderModel: { find: () => ({ limit: async () => [order] }), updateOne },
      businessModel: {
        findById: () => ({ select: () => ({ lean: async () => ({ business_name: 'Tola Studio' }) }) }),
      },
      vendorRecipients: { resolve: jest.fn().mockResolvedValue([{ userId: 'u-ops' }]) },
      notificationsService: { create, notifyPlatformAdmins },
    });
    return { go: (now: Date) => service.checkUncollectedShipments(now), updateOne, create, notifyPlatformAdmins };
  };

  const booked = (over: any = {}) => ({
    _id: 's1',
    business: store,
    status: ShipmentStatus.SHIPPED,
    shipped_at: new Date('2026-11-24T09:00:00Z'),
    pickup_date: '2026-11-24',
    shipment_id: 'SB-1',
    ...over,
  });

  it('tells the store and the ops team about a parcel nobody collected', async () => {
    const t = run([booked()]);
    await t.go(new Date('2026-11-25T12:00:00Z'));
    await flush();

    expect(t.updateOne).toHaveBeenCalledWith(
      { _id: 'o1', shipments: { $elemMatch: { _id: 's1', pickup_alerted_at: null } } },
      { $set: { 'shipments.$.pickup_alerted_at': new Date('2026-11-25T12:00:00Z') } },
    );
    const vendor = t.create.mock.calls[0][0];
    expect(vendor.recipient).toBe('u-ops');
    expect(vendor.recipient_business).toBe(store);
    expect(vendor.type).toBe('pickup_missed');
    expect(vendor.title).toBe('Parcel not collected');
    const admin = t.notifyPlatformAdmins.mock.calls[0][0];
    expect(admin.body).toContain("Tola Studio's parcel for order #ORD-1 was booked for 2026-11-24");
    expect(admin.metadata.problem).toBe('not_collected');
  });

  it('waits until the parcel is due', async () => {
    const t = run([booked()]);
    await t.go(new Date('2026-11-25T10:00:00Z'));
    expect(t.updateOne).not.toHaveBeenCalled();
    expect(t.create).not.toHaveBeenCalled();
  });

  it('flags a courier cancellation straight away', async () => {
    const t = run([booked({ status: ShipmentStatus.FAILED })]);
    await t.go(new Date('2026-11-24T10:00:00Z'));
    await flush();
    expect(t.create.mock.calls[0][0].title).toBe('Courier cancelled the pickup');
    expect(t.notifyPlatformAdmins.mock.calls[0][0].metadata.problem).toBe('courier_cancelled');
  });

  it('sends nothing when another run already flagged it', async () => {
    const t = run([booked()], 0);
    await t.go(new Date('2026-11-26T12:00:00Z'));
    await flush();
    expect(t.create).not.toHaveBeenCalled();
    expect(t.notifyPlatformAdmins).not.toHaveBeenCalled();
  });
});
