import { Types } from 'mongoose';
import { OrderService } from './orders.service';
import { ShipmentStatus, ShipmentType } from './schemas/orders.schema';

/**
 * What happens when a vendor fulfils their part of an order: every refusal
 * leaves the part at 'pending' (never parked at 'ready_to_ship' with no
 * courier), a rejected part never holds the order back, and the customer
 * hears the courier is booked.
 */

const store = new Types.ObjectId().toString();
const otherStore = new Types.ObjectId().toString();
const fabricStore = new Types.ObjectId().toString();
const customer = new Types.ObjectId().toString();

const myShipment = (over: any = {}) => ({
  business: store,
  confirmed: true,
  status: ShipmentStatus.PENDING,
  shipment_type: ShipmentType.VENDOR_TO_CUSTOMER,
  request_token: 'tok',
  courier_id: 'c1',
  service_code: 'SB-STD',
  rate_fetched_at: new Date(),
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
  opts: { paid?: boolean; label?: () => Promise<any> } = {},
) => {
  const service: any = Object.create(OrderService.prototype);
  const pre = orderDoc(shipments.map((s) => ({ ...s })));
  const claimed = orderDoc(shipments.map((s) => ({ ...s })));
  const findOneAndUpdate = jest.fn().mockResolvedValue(claimed);
  const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const create = jest.fn().mockResolvedValue({});
  const createShipmentFromToken = jest.fn(
    opts.label ??
      (async () => ({
        order_id: 'SB-1',
        courier: { tracking_code: 'TRK-1', name: 'Kwik' },
        tracking_url: 'https://track.example/TRK-1',
      })),
  );
  Object.assign(service, {
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    orderModel: { findOne: jest.fn().mockResolvedValue(pre), findOneAndUpdate, updateOne },
    businessModel: { find: jest.fn().mockResolvedValue([{ business_name: 'Ada Fabrics' }]) },
    transactionService: {
      findByOrderId: jest.fn().mockResolvedValue({ status: opts.paid === false ? 'pending' : 'success' }),
    },
    logisticService: { createShipmentFromToken, fetchRates: jest.fn() },
    notificationsService: { create },
    assertOrderPaid: jest.fn().mockResolvedValue(undefined),
  });
  const business = { _id: store, business_name: 'Tola Studio', address_code: 2 };
  const fulfil = () => service.fulfillVendorShipment('ORD-1', business, {});
  return { fulfil, claimed, findOneAndUpdate, updateOne, create, createShipmentFromToken };
};

const flush = () => new Promise((r) => setImmediate(r));

describe('vendor fulfils their part of an order', () => {
  it('books the courier, marks the part shipped and tells the customer', async () => {
    const t = setup([myShipment()]);
    const res = await t.fulfil();
    await flush();

    expect(res.data.order_status).toBe('in_transit');
    const s = t.claimed.shipments[0] as any;
    expect(s.status).toBe(ShipmentStatus.SHIPPED);
    expect(s.tracking_number).toBe('TRK-1');
    expect(s.tracking_events.map((e: any) => e.status)).toEqual(['booked']);

    expect(t.create).toHaveBeenCalledTimes(1);
    const note = t.create.mock.calls[0][0];
    expect(note.recipient).toBe(customer);
    expect(note.audience).toBe('customer');
    expect(note.title).toBe('Courier booked');
    expect(note.body).toContain('Tola Studio');
    expect(note.metadata).toMatchObject({ stage: 'booked', tracking_url: 'https://track.example/TRK-1' });
    expect(note.action_url).toBe('/profile?tab=orders&order=ORD-1&view=track');
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
});
