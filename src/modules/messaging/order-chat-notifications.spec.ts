import { Types } from 'mongoose';
import { MessagingService } from './messaging.service';
import { NotificationType } from '../notifications/schemas/notification.schema';

/**
 * The chat's socket push only reaches someone who already has the thread open,
 * which was nobody most of the time — both clients connect the socket only
 * while the chat UI is mounted. These cover the two things that replaced that
 * silence: a bell entry for the recipient, and a count that says which order
 * has a reply waiting.
 */
describe('Bespoke order chat — knowing you were messaged', () => {
  const ORDER_ID = new Types.ObjectId();
  const CUSTOMER_ID = new Types.ObjectId();
  const TAILOR_BUSINESS_ID = new Types.ObjectId();
  const TAILOR_USER_ID = new Types.ObjectId();
  const REFERENCE = 'QLZ-2026-00841';

  const order = {
    _id: ORDER_ID,
    reference: REFERENCE,
    customer: CUSTOMER_ID,
    type: 'bespoke',
    status: 'processing',
    shipments: [
      { shipment_type: 'vendor_to_customer', business: TAILOR_BUSINESS_ID },
    ],
  };

  let notifications: { createUnique: jest.Mock; create: jest.Mock };
  let messageModel: any;
  let businessModel: any;
  let orderModel: any;
  let service: MessagingService;

  // Mongoose chains are only as deep as the service actually walks them.
  const leanOf = (value: unknown) => ({
    select: () => ({ lean: () => Promise.resolve(value) }),
  });

  beforeEach(() => {
    notifications = {
      createUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(null),
    };

    messageModel = {
      create: jest.fn().mockImplementation((doc: any) => ({
        ...doc,
        _id: new Types.ObjectId(),
        toObject: () => doc,
      })),
      find: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) }),
      updateMany: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue([]),
    };

    orderModel = { findOne: () => leanOf(order) };
    businessModel = {
      findById: () =>
        leanOf({
          created_by: { id: TAILOR_USER_ID },
          business_name: 'Ibidun Atelier',
        }),
    };

    service = new MessagingService(
      messageModel,
      orderModel,
      businessModel,
      { emit: jest.fn() } as any,
      notifications as any,
    );
  });

  describe('who gets told', () => {
    it('tells the tailor when the customer writes', async () => {
      await service.sendMessage(REFERENCE, { user: { id: String(CUSTOMER_ID) } }, 'Can the sleeves be longer?');

      expect(notifications.createUnique).toHaveBeenCalledTimes(1);
      const [payload, uniqueBy] = notifications.createUnique.mock.calls[0];
      expect(payload.recipient).toBe(String(TAILOR_USER_ID));
      expect(payload.type).toBe(NotificationType.NEW_MESSAGE);
      expect(payload.action_url).toBe('/orders');
      // Keyed on the order so a burst of messages collapses to one entry.
      expect(uniqueBy).toBe('order_id');
      expect(payload.metadata.order_id).toBe(String(ORDER_ID));
    });

    it('tells the customer when the tailor replies', async () => {
      await service.sendMessage(
        REFERENCE,
        { user: { id: String(TAILOR_USER_ID) }, business: { id: String(TAILOR_BUSINESS_ID) } },
        'Yes — two inches?',
      );

      const [payload] = notifications.createUnique.mock.calls[0];
      expect(payload.recipient).toBe(String(CUSTOMER_ID));
      expect(payload.action_url).toBe('/profile?tab=orders');
    });

    it('never notifies the sender of their own message', async () => {
      await service.sendMessage(REFERENCE, { user: { id: String(CUSTOMER_ID) } }, 'Hello?');

      const recipients = notifications.createUnique.mock.calls.map(
        ([p]: any[]) => String(p.recipient),
      );
      expect(recipients).not.toContain(String(CUSTOMER_ID));
    });

    it('truncates a long message rather than putting it all in the bell', async () => {
      await service.sendMessage(REFERENCE, { user: { id: String(CUSTOMER_ID) } }, 'x'.repeat(400));

      const [payload] = notifications.createUnique.mock.calls[0];
      expect(payload.body.length).toBeLessThanOrEqual(93);
      expect(payload.body.endsWith('...')).toBe(true);
    });

    it('still delivers the message when the bell throws', async () => {
      notifications.createUnique.mockRejectedValue(new Error('mongo down'));

      const res = await service.sendMessage(REFERENCE, { user: { id: String(CUSTOMER_ID) } }, 'Hi');

      expect(res.data).toBeDefined();
      expect(messageModel.create).toHaveBeenCalled();
    });
  });

  describe('unread counts', () => {
    const matchStage = () => messageModel.aggregate.mock.calls[0][0][0];

    it('counts the vendor side by business, cast to an ObjectId', async () => {
      // req.business.id is a string; an aggregation $match never casts it, so a
      // raw string here would silently match nothing.
      await service.unreadCounts({
        user: { id: String(TAILOR_USER_ID) },
        business: { id: String(TAILOR_BUSINESS_ID) },
      });

      const { $match } = matchStage();
      expect($match.business).toBeInstanceOf(Types.ObjectId);
      expect(String($match.business)).toBe(String(TAILOR_BUSINESS_ID));
      expect($match.read_by_vendor).toBe(false);
      expect($match.sender_role).toEqual({ $ne: 'vendor' });
    });

    it('counts the customer side by user when there is no business', async () => {
      await service.unreadCounts({ user: { id: String(CUSTOMER_ID) } });

      const { $match } = matchStage();
      expect($match.customer).toBeInstanceOf(Types.ObjectId);
      expect(String($match.customer)).toBe(String(CUSTOMER_ID));
      expect($match.read_by_customer).toBe(false);
    });

    it('returns a total and a per-reference map', async () => {
      messageModel.aggregate.mockResolvedValue([
        { _id: REFERENCE, count: 3 },
        { _id: 'QLZ-2026-00900', count: 1 },
      ]);

      const { data } = await service.unreadCounts({ user: { id: String(CUSTOMER_ID) } });

      expect(data.total).toBe(4);
      expect(data.per_order).toEqual({ [REFERENCE]: 3, 'QLZ-2026-00900': 1 });
    });

    it('is zero for a caller with neither identity, without querying', async () => {
      const { data } = await service.unreadCounts({});
      expect(data).toEqual({ total: 0, per_order: {} });
      expect(messageModel.aggregate).not.toHaveBeenCalled();
    });
  });
});
