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

/**
 * Drops the old global unique indexes (email_1, phone_number_1) once the
 * per-type ones exist. Converges: the schema no longer declares the old
 * indexes, so nothing recreates them, and later boots find nothing to drop.
 * Every machine runs it; a race just means "index not found". A failure only
 * logs, because the app must still boot.
 */
@Injectable()
export class LinkedAccountsIndexMigration implements OnModuleInit {
  private readonly logger = new Logger(LinkedAccountsIndexMigration.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async onModuleInit() {
    try {
      // Build the per-type indexes first, so uniqueness is never off.
      await this.userModel.createIndexes();
      for (const name of ['email_1', 'phone_number_1']) {
        try {
          await this.userModel.collection.dropIndex(name);
          this.logger.log(`Dropped old global index users.${name}`);
        } catch (e: any) {
          if (e?.codeName !== 'IndexNotFound' && e?.code !== 27) throw e;
        }
      }
    } catch (e: any) {
      this.logger.warn(`Linked-account index migration failed: ${e?.message}`);
    }
  }
}
