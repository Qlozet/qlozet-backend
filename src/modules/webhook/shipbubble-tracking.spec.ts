import { WebhookService } from './webhook.service';

/**
 * Each courier update is kept on the parcel, so the customer sees a timeline,
 * and the customer is told only when something actually changes.
 */
describe('Shipbubble tracking timeline', () => {
  let order: any;
  let service: any;
  let customerNotices: string[];
  let directNotices: string[];

  beforeEach(() => {
    customerNotices = [];
    directNotices = [];
    order = {
      _id: 'o1',
      reference: 'ORD-1',
      customer: 'c1',
      status: 'processing',
      shipments: [
        {
          shipment_id: 'SB-1',
          tracking_number: 'TRK-1',
          status: 'shipped',
          tracking_events: [{ status: 'booked', at: new Date(0) }],
        },
      ],
      save: async () => order,
    };
    service = Object.create(WebhookService.prototype);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      orderModel: { findOne: async () => order },
      notificationsService: {
        create: async (n: any) => {
          directNotices.push(n.title);
        },
      },
      notifyVendorShippingUpdate: async () => undefined,
      notifyCustomerShippingUpdate: async (_o: any, status: string) => {
        customerNotices.push(status);
      },
    });
  });

  const send = (status: string, extra: Record<string, any> = {}) =>
    service.handleShipbubbleWebhook({ order_id: 'SB-1', status, ...extra });

  it('records each new courier state, oldest first', async () => {
    await send('picked_up', { description: 'Collected from vendor' });
    await send('in_transit');
    await send('out_for_delivery');
    const events = order.shipments[0].tracking_events;
    expect(events.map((e: any) => e.status)).toEqual([
      'booked',
      'picked_up',
      'in_transit',
      'out_for_delivery',
    ]);
    expect(events[1].message).toBe('Collected from vendor');
  });

  it('ignores a repeated state, and does not notify the customer again', async () => {
    await send('in_transit');
    await send('in_transit');
    expect(
      order.shipments[0].tracking_events.filter((e: any) => e.status === 'in_transit'),
    ).toHaveLength(1);
    // Shipped -> in transit is one change, so one "on its way".
    expect(customerNotices).toEqual(['in_transit']);
  });

  it('sends its own message when the parcel is out for delivery', async () => {
    await send('in_transit');
    await send('out_for_delivery');
    await send('out_for_delivery');
    expect(directNotices).toEqual(['Out for delivery today 📦']);
  });

  it('keeps a https tracking link the courier sends, and nothing else', async () => {
    await send('in_transit', { tracking_url: 'javascript:alert(1)' });
    expect(order.shipments[0].tracking_url).toBeUndefined();
    await send('out_for_delivery', { tracking_url: 'https://track.example/TRK-1' });
    expect(order.shipments[0].tracking_url).toBe('https://track.example/TRK-1');
  });
});
