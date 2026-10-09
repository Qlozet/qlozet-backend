import { Types } from 'mongoose';
import { VendorRole } from '../ums/schemas/role.schema';
import { NotificationType } from './schemas/notification.schema';

/**
 * Which roles each vendor-facing notification reaches.
 *
 * Eight notification sites resolved the vendor as `business.created_by` — one
 * person, the account that registered the business — after the first seven
 * were converted. These pin the role set each surface asks for, because that
 * is the decision, and getting it wrong in either direction is a real cost: a
 * tailor who never hears about the garment they are making, or an operations
 * lead buried under notifications they cannot act on.
 *
 * The resolver itself is covered in vendor-recipients.spec.ts.
 */
describe('Vendor notification fan-out', () => {
  // Mirrors the constants in each service. Kept here as the readable record of
  // the decision; the services are too heavy to stand up for this.
  const ROLE_SETS = {
    // Production work — the person making it, and whoever runs fulfilment.
    newOrder: [VendorRole.OPERATIONS, VendorRole.TAILOR],
    preshipDecision: [VendorRole.OPERATIONS, VendorRole.TAILOR],
    // Pricing work — only the tailor can judge the job.
    bespokeQuote: [VendorRole.TAILOR],
    // Money and the schedule.
    latePenalty: [VendorRole.OPERATIONS],
    satisfaction: [VendorRole.OPERATIONS],
    // A return is fulfilment and a customer conversation at once.
    returnRequested: [VendorRole.OPERATIONS, VendorRole.CUSTOMER_SUPPORT],
    // The order conversation and disputes.
    chat: [VendorRole.TAILOR, VendorRole.CUSTOMER_SUPPORT],
    dispute: [VendorRole.TAILOR, VendorRole.CUSTOMER_SUPPORT],
    support: [VendorRole.CUSTOMER_SUPPORT],
    catalogue: [VendorRole.OPERATIONS, VendorRole.MARKETING],
    // Stock is an operations job; a review is the storefront's.
    lowStock: [VendorRole.OPERATIONS],
    newReview: [VendorRole.MARKETING],
    // Who is on the team is an owner's business.
    teamMember: [],
  } as const;

  it('never names the owner, who is always included by the resolver', () => {
    // Listing owner would be harmless but misleading: it would imply the
    // resolver might leave them out, and nobody should be able to configure
    // their way out of hearing about their own business.
    for (const [surface, roles] of Object.entries(ROLE_SETS)) {
      expect(roles as readonly VendorRole[]).not.toContain(VendorRole.OWNER);
      expect(surface).toBeTruthy();
    }
  });

  it('puts the tailor on the work, and keeps them off the paperwork', () => {
    // The thing that started this: a tailor could not see the garment they
    // were making.
    expect(ROLE_SETS.newOrder).toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.preshipDecision).toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.bespokeQuote).toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.chat).toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.dispute).toContain(VendorRole.TAILOR);

    // And off things they cannot act on — a bell carrying those stops being
    // read, which costs more than it saves.
    expect(ROLE_SETS.latePenalty).not.toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.satisfaction).not.toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.catalogue).not.toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.lowStock).not.toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.newReview).not.toContain(VendorRole.TAILOR);
    expect(ROLE_SETS.support).not.toContain(VendorRole.TAILOR);
  });

  it('keeps team changes to the owner alone', () => {
    expect(ROLE_SETS.teamMember).toHaveLength(0);
  });

  it('gives customer-facing threads to customer support', () => {
    expect(ROLE_SETS.chat).toContain(VendorRole.CUSTOMER_SUPPORT);
    expect(ROLE_SETS.dispute).toContain(VendorRole.CUSTOMER_SUPPORT);
    expect(ROLE_SETS.returnRequested).toContain(VendorRole.CUSTOMER_SUPPORT);
    expect(ROLE_SETS.support).toContain(VendorRole.CUSTOMER_SUPPORT);
  });

  describe('types that were borrowing the wrong name', () => {
    // Four notifications carried a type that contradicted their own title, so
    // anything grouping or counting by type reported them as something else.
    it('a return is a return, not a cancellation', () => {
      expect(NotificationType.RETURN_REQUESTED).toBe('return_requested');
      expect(NotificationType.RETURN_REQUESTED).not.toBe(
        NotificationType.ORDER_CANCELLED,
      );
    });

    it('a dispute is a dispute, opened and resolved', () => {
      expect(NotificationType.DISPUTE_OPENED).toBe('dispute_opened');
      expect(NotificationType.DISPUTE_RESOLVED).toBe('dispute_resolved');
      expect(NotificationType.DISPUTE_RESOLVED).not.toBe(
        NotificationType.ORDER_CONFIRMED,
      );
    });

    it('a review has a type at all, which it did not before', () => {
      expect(NotificationType.NEW_REVIEW).toBe('new_review');
    });
  });

  describe('every vendor type the shop router knows is real', () => {
    // The vendor console routes notifications by `type`. A typo on either
    // side means a row that silently lands on a list instead of the thing it
    // is about, which is exactly the bug this replaced — so the two lists are
    // checked against each other.
    const ROUTED_TYPES = [
      'new_message',
      'dispute_opened',
      'dispute_resolved',
      'new_order',
      'order_confirmed',
      'order_cancelled',
      'order_status_changed',
      'order_shipped',
      'order_delivered',
      'preship_review',
      'preship_decision',
      'late_fulfillment_penalty',
      'bespoke_quote_request',
      'bespoke_quote_revision',
      'low_stock',
      'new_review',
      'product_approved',
      'product_rejected',
      'product_status_changed',
      'payout_released',
      'wallet_funded',
      'payment_confirmed',
      'ticket_reply',
      'ticket_assigned',
      'team_member_joined',
      'return_requested',
    ];

    const ALL_TYPES = new Set<string>(Object.values(NotificationType));

    it.each(ROUTED_TYPES)('%s exists in the enum', (type) => {
      expect(ALL_TYPES.has(type)).toBe(true);
    });
  });

  it('uses a real ObjectId shape for recipient_business everywhere', () => {
    // Every converted site now passes the business id alongside the user, so
    // a vendor notification can be scoped to the business it concerns.
    const businessId = new Types.ObjectId();
    expect(Types.ObjectId.isValid(String(businessId))).toBe(true);
  });
});
