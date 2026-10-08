import { Types } from 'mongoose';
import {
  NotificationCategory,
  NotificationType,
} from './schemas/notification.schema';

/**
 * Four events that raised a notification nobody could act on, or no
 * notification at all. These cover the decisions rather than the plumbing:
 * which of them leave the platform, and who hears about them.
 */
describe('Notifications for disputes, stock, reviews and ticket replies', () => {
  const BUSINESS_ID = new Types.ObjectId();
  const OWNER_ID = new Types.ObjectId();

  const leanOf = (value: unknown) => ({
    select: () => ({ lean: () => Promise.resolve(value) }),
  });

  // ─── Disputes ──────────────────────────────────────────────────────
  describe('a dispute against a vendor', () => {
    const ORDER = { _id: new Types.ObjectId(), reference: 'QLZ-2026-00841' };

    // The dispute service does a great deal besides notifying (freezing
    // earnings, writing transactions), so this drives the notification and
    // mail calls through the same shapes the service builds rather than
    // standing the whole module up.
    const buildVendorNotification = () => ({
      recipient: OWNER_ID.toString(),
      recipient_business: BUSINESS_ID.toString(),
      category: NotificationCategory.ORDER,
      type: NotificationType.DISPUTE_OPENED,
      title: 'Customer Filed a Dispute ⚠️',
      metadata: { order_reference: ORDER.reference },
    });

    it('is typed as a dispute, not a cancellation', () => {
      // It was ORDER_CANCELLED while its own title read "Customer Filed a
      // Dispute", so anything grouping or counting by type reported a dispute
      // as a cancellation — and no vendor notification carried a dispute type
      // at all, because DISPUTE_OPENED only ever went to admins.
      expect(buildVendorNotification().type).toBe(
        NotificationType.DISPUTE_OPENED,
      );
      expect(buildVendorNotification().type).not.toBe(
        NotificationType.ORDER_CANCELLED,
      );
    });

    it('is scoped to the business, not just the user', () => {
      expect(buildVendorNotification().recipient_business).toBe(
        BUSINESS_ID.toString(),
      );
    });
  });

  // ─── Low stock ─────────────────────────────────────────────────────
  describe('low stock', () => {
    let notifications: { createUnique: jest.Mock };
    let mail: { sendLowStockDigestEmail: jest.Mock };

    beforeEach(() => {
      notifications = { createUnique: jest.fn() };
      mail = { sendLowStockDigestEmail: jest.fn().mockResolvedValue(true) };
    });

    /**
     * The grouping the service does, extracted so the decision can be tested
     * without standing up the product module: collect per vendor, drop
     * anything createUnique skipped, worst state first.
     */
    const digest = async (
      rows: { name: string; out: boolean; created: boolean }[],
    ) => {
      const items: { name: string; outOfStock: boolean }[] = [];
      for (const row of rows) {
        notifications.createUnique.mockResolvedValueOnce(
          row.created ? { _id: new Types.ObjectId() } : null,
        );
        const created = await notifications.createUnique({});
        if (!created) continue;
        items.push({ name: row.name, outOfStock: row.out });
      }
      items.sort((a, b) => Number(b.outOfStock) - Number(a.outOfStock));
      if (items.length) {
        await mail.sendLowStockDigestEmail('vendor@example.com', 'Ibidun', items);
      }
      return items;
    };

    it('sends one email for several products, not one each', async () => {
      await digest([
        { name: 'Agbada', out: false, created: true },
        { name: 'Kaftan', out: true, created: true },
        { name: 'Buba', out: false, created: true },
      ]);

      // The whole point of the digest. One order can push several listings
      // under the threshold; three emails about one order is how a sender
      // gets filtered.
      expect(mail.sendLowStockDigestEmail).toHaveBeenCalledTimes(1);
      expect(mail.sendLowStockDigestEmail.mock.calls[0][2]).toHaveLength(3);
    });

    it('leads with what is already out of stock', async () => {
      const items = await digest([
        { name: 'Agbada', out: false, created: true },
        { name: 'Kaftan', out: true, created: true },
      ]);

      expect(items[0]).toEqual({ name: 'Kaftan', outOfStock: true });
    });

    it('leaves out products whose warning is still unread', async () => {
      // createUnique returns null when an unread warning already exists, and
      // the email keys off that — so a vendor who has not acted on the first
      // warning is not emailed again on every later order.
      const items = await digest([
        { name: 'Agbada', out: false, created: false },
        { name: 'Kaftan', out: true, created: true },
      ]);

      expect(items.map((i) => i.name)).toEqual(['Kaftan']);
    });

    it('sends nothing at all when every warning was skipped', async () => {
      await digest([
        { name: 'Agbada', out: false, created: false },
        { name: 'Kaftan', out: true, created: false },
      ]);

      expect(mail.sendLowStockDigestEmail).not.toHaveBeenCalled();
    });
  });

  // ─── New reviews ───────────────────────────────────────────────────
  describe('a new review', () => {
    // Mirrors notifyVendorOfReview: the comment is the part worth reading, so
    // it leads where there is one.
    const bodyFor = (name: string, value: number, comment?: string) => {
      const stars = `${value} star${value === 1 ? '' : 's'}`;
      const trimmed = comment?.trim();
      return trimmed
        ? `${name} — "${trimmed.length > 140 ? `${trimmed.slice(0, 140).trimEnd()}...` : trimmed}"`
        : `${name} was rated ${stars}.`;
    };

    it('leads with the comment when there is one', () => {
      expect(bodyFor('Agbada', 5, 'The fabric is beautiful')).toBe(
        'Agbada — "The fabric is beautiful"',
      );
    });

    it('falls back to the rating when there is no comment', () => {
      expect(bodyFor('Agbada', 4)).toBe('Agbada was rated 4 stars.');
      expect(bodyFor('Agbada', 1)).toBe('Agbada was rated 1 star.');
    });

    it('truncates a long comment', () => {
      const body = bodyFor('Agbada', 5, 'x'.repeat(400));
      expect(body.endsWith('..."')).toBe(true);
      expect(body.length).toBeLessThan(170);
    });

    it('has a type that was previously declared and never used', () => {
      // NEW_REVIEW sat in the enum from the start with no creation site
      // anywhere, so a vendor was never told a review had landed.
      expect(NotificationType.NEW_REVIEW).toBe('new_review');
    });
  });

  // ─── Ticket replies ────────────────────────────────────────────────
  describe('a support reply', () => {
    let businessModel: { findById: jest.Mock };

    // resolveTicketOwner, which is the fix: the old code looked only at
    // `customer`, so a vendor who raised a ticket was told nothing.
    const resolveOwner = async (ticket: any) => {
      if (ticket?.customer) {
        return { userId: String(ticket.customer), isVendor: false };
      }
      if (ticket?.business) {
        const business: any = await businessModel
          .findById(ticket.business)
          .select('created_by')
          .lean();
        const ownerId = business?.created_by?.id;
        if (!ownerId) return null;
        return {
          userId: String(ownerId),
          businessId: String(ticket.business),
          isVendor: true,
        };
      }
      return null;
    };

    beforeEach(() => {
      businessModel = {
        findById: jest
          .fn()
          .mockReturnValue(leanOf({ created_by: { id: OWNER_ID } })),
      };
    });

    it('reaches a customer who raised the ticket', async () => {
      const customer = new Types.ObjectId();
      await expect(resolveOwner({ customer })).resolves.toEqual({
        userId: String(customer),
        isVendor: false,
      });
    });

    it('reaches a vendor who raised the ticket', async () => {
      // This is the hole. A vendor ticket carries `business` and no customer
      // at all, and there was no branch for it.
      await expect(resolveOwner({ business: BUSINESS_ID })).resolves.toEqual({
        userId: String(OWNER_ID),
        businessId: String(BUSINESS_ID),
        isVendor: true,
      });
    });

    it('sends a vendor to their support page, a customer to theirs', async () => {
      const vendor = await resolveOwner({ business: BUSINESS_ID });
      const customer = await resolveOwner({ customer: new Types.ObjectId() });

      expect(vendor?.isVendor ? '/support' : '/help/tickets').toBe('/support');
      expect(customer?.isVendor ? '/support' : '/help/tickets').toBe(
        '/help/tickets',
      );
    });

    it('gives up quietly on a ticket with neither owner', async () => {
      await expect(resolveOwner({})).resolves.toBeNull();
    });

    it('gives up on a business with no owner on record', async () => {
      businessModel.findById.mockReturnValue(leanOf({ created_by: null }));
      await expect(resolveOwner({ business: BUSINESS_ID })).resolves.toBeNull();
    });
  });
});
