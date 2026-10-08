import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VendorRole } from '../ums/schemas/role.schema';

export interface VendorRecipient {
  userId: string;
  email?: string;
  name?: string;
  isOwner: boolean;
}

/**
 * Which people at a vendor should hear about something.
 *
 * Every feature that needed to reach a vendor used to read
 * `business.created_by`, which is one person: the account that signed the
 * business up. A team member with the `tailor` role — frequently the person
 * who actually made the garment — was unreachable by the order chat, by
 * support replies, by dispute notices and by stock warnings alike. The same
 * bug in four places, because each one solved it the same wrong way.
 *
 * The owner is themselves a TeamMember row, created with the business and
 * carrying the `owner` role, so one query over TeamMember covers the owner and
 * their staff together and `created_by` is not needed at all.
 *
 * Note this is about DELIVERY, not permission. Authorisation is already
 * business-scoped — the RolesGuard puts the whole business on the request, so
 * a tailor could always open an order chat thread or read a ticket. They
 * simply were never told there was anything to open.
 */
@Injectable()
export class VendorRecipientsService {
  private readonly logger = new Logger(VendorRecipientsService.name);

  constructor(
    @InjectModel('TeamMember') private readonly teamMemberModel: Model<any>,
    @InjectModel('Role') private readonly roleModel: Model<any>,
  ) {}

  /**
   * Active team members at `businessId` holding any of `roles`.
   *
   * The owner is always included whether or not `owner` is in `roles`: nobody
   * should be able to configure their way out of hearing about their own
   * business.
   *
   * Returns an empty list rather than throwing. Every caller is notifying
   * someone as a side effect of real work, and a lookup failure must not fail
   * the dispute, the message or the order that triggered it.
   */
  async resolve(
    businessId: string | Types.ObjectId | undefined | null,
    roles: VendorRole[],
  ): Promise<VendorRecipient[]> {
    try {
      if (!businessId) return [];

      const wanted = new Set<string>([
        VendorRole.OWNER,
        ...roles.map((r) => String(r).toLowerCase()),
      ]);

      // Role names are matched case-insensitively, the same way the guard
      // does it — seeded role documents are not guaranteed to be lower case.
      const roleDocs = await this.roleModel
        .find({}, { _id: 1, name: 1 })
        .lean();
      const roleIds = roleDocs
        .filter((r: any) => wanted.has(String(r?.name ?? '').toLowerCase()))
        .map((r: any) => r._id);

      if (!roleIds.length) return [];

      const members = await this.teamMemberModel
        .find({
          business: new Types.ObjectId(String(businessId)),
          role: { $in: roleIds },
          is_active: true,
          // An invited member who has not accepted has no user account yet,
          // so there is nobody to put a notification against.
          accepted: true,
          user: { $ne: null },
        })
        .populate('role', 'name')
        .lean();

      // Dedupe by user: the same person can hold more than one row, and two
      // bell entries for one event reads as a bug.
      const seen = new Map<string, VendorRecipient>();
      for (const m of members as any[]) {
        const userId = m?.user ? String(m.user) : null;
        if (!userId || seen.has(userId)) continue;
        seen.set(userId, {
          userId,
          email: m?.email,
          name: m?.full_name,
          isOwner:
            String((m?.role as any)?.name ?? '').toLowerCase() ===
              VendorRole.OWNER ||
            m?.is_owner === true,
        });
      }

      return [...seen.values()];
    } catch (err: any) {
      this.logger.error(
        `Failed to resolve vendor recipients for ${String(businessId)}: ${err?.message}`,
      );
      return [];
    }
  }

  /** The owner alone, for the few things that are genuinely owner-only. */
  async owner(
    businessId: string | Types.ObjectId | undefined | null,
  ): Promise<VendorRecipient | null> {
    const all = await this.resolve(businessId, []);
    return all.find((r) => r.isOwner) ?? all[0] ?? null;
  }
}
