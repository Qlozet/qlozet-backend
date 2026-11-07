import { User } from '../ums/schemas/user.schema';
import {
  signedUpKey,
  waitlistCsv,
  waitlistFilter,
  waitlistPaging,
  type WaitlistQuery,
  type WaitlistRow,
} from './waitlist-admin';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Waitlist, WaitlistDocument, WaitlistType } from './schema/waitlist.schema';
import { CustomerWaitlistDto, VendorWaitlistDto } from './dto/waitlist.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectModel(Waitlist.name) private waitlistModel: Model<WaitlistDocument>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  // ── Admin console ──────────────────────────────────────────

  /** Mark each row signed_up when an account of the same type uses its email. */
  private async withSignedUp(rows: any[]): Promise<WaitlistRow[]> {
    if (!rows.length) return [];
    const emails = [...new Set(rows.map((r) => String(r.email).trim().toLowerCase()))];
    const users = await this.userModel
      .find({ email: { $in: emails }, type: { $in: ['customer', 'vendor'] } }, { email: 1, type: 1 })
      .lean<{ email: string; type: string }[]>();
    const have = new Set(users.map((u) => signedUpKey(u.email, u.type)));
    return rows.map((r) => ({
      type: r.type,
      fullName: r.fullName,
      email: r.email,
      phoneNumber: r.phoneNumber ?? null,
      businessName: r.businessName ?? null,
      businessType: r.businessType ?? null,
      createdAt: r.createdAt ?? null,
      signed_up: have.has(signedUpKey(r.email, r.type)),
    }));
  }

  async adminList(q: WaitlistQuery) {
    const filter = waitlistFilter(q);
    const { page, size, skip } = waitlistPaging(q);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [rows, matching, total, customers, vendors, thisWeek] = await Promise.all([
      this.waitlistModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      this.waitlistModel.countDocuments(filter),
      this.waitlistModel.countDocuments({}),
      this.waitlistModel.countDocuments({ type: WaitlistType.CUSTOMER }),
      this.waitlistModel.countDocuments({ type: WaitlistType.VENDOR }),
      this.waitlistModel.countDocuments({ createdAt: { $gte: weekAgo } }),
    ]);
    return {
      data: await this.withSignedUp(rows),
      page,
      size,
      total_items: matching,
      has_next_page: skip + rows.length < matching,
      totals: { total, customers, vendors, this_week: thisWeek },
    };
  }

  async adminExportCsv(q: WaitlistQuery): Promise<string> {
    const rows = await this.waitlistModel.find(waitlistFilter(q)).sort({ createdAt: -1 }).lean();
    return waitlistCsv(await this.withSignedUp(rows));
  }

  async joinCustomerWaitlist(dto: CustomerWaitlistDto) {
    try {
      const existing = await this.waitlistModel.findOne({ email: dto.email });
      if (existing) {
        // Return success even if they already joined to avoid leaking emails
        return { message: 'Successfully joined the customer waitlist!' };
      }

      await this.waitlistModel.create({
        type: WaitlistType.CUSTOMER,
        fullName: dto.fullName,
        email: dto.email,
      });

      return { message: 'Successfully joined the customer waitlist!' };
    } catch (error) {
      this.logger.error(`Error joining customer waitlist: ${error.message}`);
      throw error;
    }
  }

  async joinVendorWaitlist(dto: VendorWaitlistDto) {
    try {
      const existing = await this.waitlistModel.findOne({ email: dto.businessEmail });
      if (existing) {
        return { message: 'Successfully joined the vendor waitlist!' };
      }

      await this.waitlistModel.create({
        type: WaitlistType.VENDOR,
        fullName: dto.fullName,
        email: dto.businessEmail, // mapping businessEmail to the schema's email field
        businessName: dto.businessName,
        phoneNumber: dto.phoneNumber,
        businessType: dto.businessType,
      });

      return { message: 'Successfully joined the vendor waitlist!' };
    } catch (error) {
      this.logger.error(`Error joining vendor waitlist: ${error.message}`);
      throw error;
    }
  }
}
