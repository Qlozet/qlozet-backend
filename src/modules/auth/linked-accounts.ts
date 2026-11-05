import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserType } from '../ums/schemas/user.schema';

/**
 * Linked accounts: one person, one email, two accounts.
 *
 * A shopping account (customer) and a store account (vendor) may share an
 * email and phone number. They stay separate user documents, so orders,
 * wallets, notifications and permissions never mix, but they are the same
 * person: the email was proven for both (a code, Google, or the password of
 * the other account), so they share one password. Changing or resetting it
 * on either side changes both.
 *
 * Ways in:
 * - a shopper signs up for a store with the same email and their shop
 *   password: the store is ready at once, no code (registerVendor);
 * - a shopper opens a store from the shop (openStoreForCustomer);
 * - a store owner signs in on the shop: the shopping account is created on
 *   the spot (loginCustomer, loginWithGoogle);
 * - a shopper is added to a store's team (TeamService.inviteMember).
 *
 * Staff (platform) accounts never link: their emails stay apart from both.
 */
export const LINKABLE_TYPES: UserType[] = [UserType.CUSTOMER, UserType.VENDOR];

/** Each old global index and the per-type index that replaces it. */
export const LINKED_INDEX_SWAPS = [
  {
    old: 'email_1',
    key: { email: 1, type: 1 },
    options: { unique: true, name: 'email_type_unique' },
  },
  {
    old: 'phone_number_1',
    key: { phone_number: 1, type: 1 },
    options: {
      unique: true,
      name: 'phone_type_unique',
      partialFilterExpression: { phone_number: { $type: 'string' } },
    },
  },
] as const;

/**
 * Swaps the old global unique indexes (email_1, phone_number_1) for the
 * per-type ones. Each pair is handled on its own: the old index is dropped
 * as soon as its replacement exists, so nothing else (another index failing
 * to build, a duplicate phone) can leave email_1 in place. While email_1
 * stays, adding a shopper to a team or opening a store on a shopping email
 * fails with a duplicate-key error.
 *
 * Converges: the schema no longer declares the old indexes, so nothing
 * recreates them, and later boots find nothing to drop. Every machine runs
 * it; a race just means "already exists" / "index not found". A failure only
 * logs, because the app must still boot.
 */
@Injectable()
export class LinkedAccountsIndexMigration implements OnModuleInit {
  private readonly logger = new Logger(LinkedAccountsIndexMigration.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    await this.run();
  }

  async run() {
    const users = this.userModel.collection;
    for (const swap of LINKED_INDEX_SWAPS) {
      try {
        // Build the per-type index first, so uniqueness is never off.
        await users.createIndex(swap.key as any, swap.options as any);
      } catch (e: any) {
        // Already built under the same name with other options, or built by
        // another machine: fine if it exists; checked below.
        this.logger.warn(`Building users.${swap.options.name}: ${e?.message}`);
      }
      try {
        const names = (await users.indexes()).map((i: any) => i.name);
        if (!names.includes(swap.options.name)) {
          this.logger.error(
            `users.${swap.options.name} is missing, so users.${swap.old} stays. Shoppers can't be added to stores until this is fixed.`,
          );
          continue;
        }
        if (!names.includes(swap.old)) continue;
        await users.dropIndex(swap.old);
        this.logger.log(`Dropped old global index users.${swap.old}`);
      } catch (e: any) {
        if (e?.codeName === 'IndexNotFound' || e?.code === 27) continue;
        this.logger.error(`Dropping users.${swap.old} failed: ${e?.message}`);
      }
    }
  }
}
