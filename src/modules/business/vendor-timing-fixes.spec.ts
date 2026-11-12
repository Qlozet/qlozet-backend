import { Types } from 'mongoose';
import { OrderService, confirmWindowText } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookService } from '../webhook/webhook.service';
import { notifyQuoteAccepted } from '../bespoke/quote-accepted-notice';

/**
 * Pilot QA review, staging checklist BUG-14 (bespoke cancellation fee),
 * BUG-18 (notices tailors and vendors never got) and BUG-19 (the time to
 * confirm counted from before payment).
 */

const quiet = { log: () => undefined, warn: () => undefined, error: () => undefined };
const lean = (value: any) => ({ lean: async () => value });

describe('BUG-14: once the finished piece is shown, the tailor keeps at least the deposit', () => {
  const tailor = new Types.ObjectId().toString();
  const service: any = Object.create(OrderService.prototype);
  service.platformSettingsModel = { findOne: () => lean({ custom_cancellation_fee_percent: 30 }) };
  service.productModel = { find: () => ({ select: () => lean([]) }) };

  const order = (planStatus: string, photos: boolean) => ({
    type: 'bespoke',
    items: [{ _id: new Types.ObjectId(), business: new Types.ObjectId(tailor), total_price: planStatus === 'paid' ? 90_000 : 45_000 }],
    shipments: [{ business: new Types.ObjectId(tailor), confirmed: true }],
    payment_plan: { tailor, quote_total: 90_000, deposit_amount: 45_000, status: planStatus },
    ...(photos ? { preship: { submitted_at: new Date() } } : {}),
  });

  it('before photos: 30% of the quote', async () => {
    const q = await service.quoteCancellation(order('deposit_paid', false), 45_000);
    expect(q.total).toBe(27_000);
    expect(q.refund).toBe(18_000);
  });

  it('after photos, balance unpaid: the whole deposit', async () => {
    const q = await service.quoteCancellation(order('awaiting_balance', true), 45_000);
    expect(q.total).toBe(45_000);
    expect(q.refund).toBe(0);
  });

  it('after photos, balance paid: still the whole deposit, not 30%', async () => {
    const q = await service.quoteCancellation(order('paid', true), 90_000);
    expect(q.total).toBe(45_000);
    expect(q.refund).toBe(45_000);
  });

  it('balance paid early, before any photos: 30% of the quote', async () => {
    const q = await service.quoteCancellation(order('paid', false), 90_000);
    expect(q.total).toBe(27_000);
  });
});

describe('BUG-18: vendors and tailors are told', () => {
  it('bulk notifications ping the bell and phone like single ones', async () => {
    const service: any = Object.create(NotificationsService.prototype);
    const emit = jest.fn();
    service.logger = quiet;
    service.eventEmitter = { emit };
    service.notificationModel = { insertMany: async (docs: any[]) => docs.map((d, i) => ({ ...d, _id: i })) };
    const recipient = new Types.ObjectId().toString();
    await service.createMany([
      { recipient, category: 'order', type: 'new_order', title: 'a', body: 'a' },
      { recipient, category: 'order', type: 'new_order', title: 'b', body: 'b' },
    ]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('notification.created', expect.objectContaining({ title: 'a' }));
  });

  it('the tailor team hears a quote was accepted, with the deposit', async () => {
    const create = jest.fn().mockResolvedValue({});
    await notifyQuoteAccepted(
      {
        notificationsService: { create },
        vendorRecipients: { resolve: async () => [{ userId: 'owner' }, { userId: 'tailor' }] },
        logger: quiet,
      },
      {
        tailorId: 'store',
        orderId: 'o1',
        orderReference: 'BSP-7',
        quoteId: 'q1',
        quoteTotal: 90_000,
        depositAmount: 45_000,
      },
    );
    expect(create).toHaveBeenCalledTimes(2);
    const notice = create.mock.calls[0][0];
    expect(notice.type).toBe('bespoke_quote_accepted');
    expect(notice.recipient_business).toBe('store');
    expect(notice.body).toContain('₦45,000 deposit');
  });

  it('card payments send it once, however often the payment is confirmed', async () => {
    const quote: any = {
      _id: new Types.ObjectId(),
      vendor: new Types.ObjectId(),
      design: new Types.ObjectId(),
      total: 90_000,
      status: 'submitted',
      save: jest.fn(async () => undefined),
    };
    const create = jest.fn().mockResolvedValue({});
    const service: any = Object.create(WebhookService.prototype);
    Object.assign(service, {
      logger: quiet,
      bespokeQuoteModel: { findById: async () => quote, updateMany: jest.fn() },
      bespokeDesignModel: { updateOne: jest.fn() },
      notificationsService: { create },
      vendorRecipients: { resolve: async () => [{ userId: 'tailor' }] },
    });
    const order = { _id: new Types.ObjectId(), reference: 'BSP-8', bespoke_quote: quote._id, payment_plan: { deposit_amount: 45_000 } };
    await service.finalizeBespokeAcceptance(order);
    await service.finalizeBespokeAcceptance(order);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('BUG-19: the time to confirm counts from payment', () => {
  const serviceWith = (hours: number) => {
    const service: any = Object.create(OrderService.prototype);
    const find = jest.fn().mockResolvedValue([]);
    Object.assign(service, {
      logger: quiet,
      platformSettingsModel: { findOne: () => lean({ auto_reject_hours: hours }) },
      orderModel: { find },
    });
    return { service, find };
  };

  it('looks at when the order was paid, falling back to creation for older orders', async () => {
    const { service, find } = serviceWith(24);
    await service.autoRejectStaleShipments();
    const filter = find.mock.calls[0][0];
    expect(filter.status).toBe('in_review');
    expect(filter.createdAt).toBeUndefined();
    expect(filter.$or).toEqual([
      { paid_at: { $lte: expect.any(Date) } },
      { paid_at: null, createdAt: { $lte: expect.any(Date) } },
    ]);
    const cutoff = filter.$or[0].paid_at.$lte.getTime();
    expect(Math.abs(Date.now() - 24 * 3_600_000 - cutoff)).toBeLessThan(5_000);
  });

  it('0 switches it off instead of cancelling everything at once', async () => {
    const { service, find } = serviceWith(0);
    await service.autoRejectStaleShipments();
    expect(find).not.toHaveBeenCalled();
  });

  it('messages state the real window', () => {
    expect(confirmWindowText(24)).toBe('24 hours');
    expect(confirmWindowText(1)).toBe('1 hour');
    expect(confirmWindowText(48)).toBe('48 hours');
    expect(confirmWindowText(0.1)).toBe('6 minutes');
  });
});
