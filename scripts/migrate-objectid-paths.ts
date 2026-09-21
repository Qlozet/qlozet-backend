/**
 * One-time migration: convert string-stored reference ids to ObjectIds.
 *
 * Background: 25 schemas declared refs as `@Prop({ type: Types.ObjectId })`
 * (the BSON class), which @nestjs/mongoose compiles to a MIXED path — no
 * casting on save OR query. Collections therefore hold a blend of string and
 * ObjectId ids depending on which code path wrote the row (root cause of the
 * dispute payout-freeze no-op, the ticket ownership 404s, and the reply-thread
 * gaps). The schemas are now fixed to real ObjectId paths, so every NEW write
 * and query casts — this script brings the LEGACY rows in line.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-objectid-paths.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-objectid-paths.ts --apply  # write
 *
 * Reads MONGO_URI (falls back to MONGODB_URI / DATABASE_URL). Safe to re-run:
 * converted rows no longer match `$type: 'string'`. Strings that are not
 * 24-hex are left untouched ($convert onError keeps the original value).
 */
import mongoose from 'mongoose';

import { AssistantConversation } from '../src/modules/assistant/schema/conversation.schema';
import { BespokeDesign } from '../src/modules/bespoke/schemas/bespoke-design.schema';
import { BespokeQuote } from '../src/modules/bespoke/schemas/bespoke-quote.schema';
import { BespokeTemplate } from '../src/modules/bespoke/schemas/bespoke-template.schema';
import { BusinessEarning, BusinessEarningSchema } from '../src/modules/business/schemas/business-earnings.schema';
import { VendorNote, VendorNoteSchema } from '../src/modules/business/schemas/vendor-note.schema';
import { Warehouse, WarehouseSchema } from '../src/modules/business/schemas/warehouse.schema';
import { Cart, CartSchema } from '../src/modules/cart/schema/cart.schema';
import { Dispute, DisputeSchema } from '../src/modules/disputes/schemas/dispute.schema';
import { FabricClaim, FabricClaimSchema } from '../src/modules/fabric-reservation/schemas/fabric-claim.schema';
import { FabricReservation } from '../src/modules/fabric-reservation/schemas/fabric-reservation.schema';
import { HelpArticle, HelpArticleSchema } from '../src/modules/help-center/schema/help-article.schema';
import { OrderMessage, OrderMessageSchema } from '../src/modules/messaging/schemas/order-message.schema';
import { Notification, NotificationSchema } from '../src/modules/notifications/schemas/notification.schema';
import { CheckoutRateCache } from '../src/modules/orders/schemas/checkout-rate-cache.schema';
import { Collection, CollectionSchema } from '../src/modules/products/schemas/collection.schema';
import { Discount, DiscountSchema } from '../src/modules/products/schemas/discount.schema';
import { Return, ReturnSchema } from '../src/modules/returns/schemas/return.schema';
import { TicketReply, TicketReplySchema } from '../src/modules/ticket/schema/reply-ticket.schema';
import { TicketActivity } from '../src/modules/ticket/schema/ticket-activity.schema';
import { Ticket, TicketSchema } from '../src/modules/ticket/schema/ticket.schema';
import { Address, AddressSchema } from '../src/modules/ums/schemas/address.schema';
import { TeamMember, TeamMemberSchema } from '../src/modules/ums/schemas/team.schema';
import { Wallet, WalletSchema } from '../src/modules/wallets/schema/wallet.schema';

// Schemas whose files export the schema under a non-`<Class>Schema` name are
// re-created here from the class so the path metadata matches exactly.
import { SchemaFactory } from '@nestjs/mongoose';
const pairs: [string, mongoose.Schema][] = [
  [AssistantConversation.name, SchemaFactory.createForClass(AssistantConversation)],
  [BespokeDesign.name, SchemaFactory.createForClass(BespokeDesign)],
  [BespokeQuote.name, SchemaFactory.createForClass(BespokeQuote)],
  [BespokeTemplate.name, SchemaFactory.createForClass(BespokeTemplate)],
  [BusinessEarning.name, BusinessEarningSchema],
  [VendorNote.name, VendorNoteSchema],
  [Warehouse.name, WarehouseSchema],
  [Cart.name, CartSchema],
  [Dispute.name, DisputeSchema],
  [FabricClaim.name, FabricClaimSchema],
  [FabricReservation.name, SchemaFactory.createForClass(FabricReservation)],
  [HelpArticle.name, HelpArticleSchema],
  [OrderMessage.name, OrderMessageSchema],
  [Notification.name, NotificationSchema],
  [CheckoutRateCache.name, SchemaFactory.createForClass(CheckoutRateCache)],
  [Collection.name, CollectionSchema],
  [Discount.name, DiscountSchema],
  [Return.name, ReturnSchema],
  [TicketReply.name, TicketReplySchema],
  [TicketActivity.name, SchemaFactory.createForClass(TicketActivity)],
  [Ticket.name, TicketSchema],
  [Address.name, AddressSchema],
  [TeamMember.name, TeamMemberSchema],
  [Wallet.name, WalletSchema],
];

const HEX24 = /^[0-9a-fA-F]{24}$/;
const apply = process.argv.includes('--apply');

async function main() {
  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;
  if (!uri) throw new Error('Set MONGO_URI to the target database.');

  const conn = await mongoose.createConnection(uri).asPromise();
  console.log(`Connected. Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  let totalConverted = 0;
  for (const [name, schema] of pairs) {
    const model = conn.model(name, schema);
    const single: string[] = [];
    const arrays: string[] = [];
    schema.eachPath((p, type: any) => {
      if (type.instance === 'ObjectId' && p !== '_id') single.push(p);
      if (type.instance === 'Array' && type.caster?.instance === 'ObjectId') {
        arrays.push(p);
      }
    });
    if (!single.length && !arrays.length) continue;

    for (const p of single) {
      const filter = { [p]: { $type: 'string' } };
      const count = await model.countDocuments(filter);
      if (!count) continue;
      console.log(`${name}.${p}: ${count} string row(s)`);
      totalConverted += count;
      if (apply) {
        await model.updateMany(filter, [
          {
            $set: {
              [p]: {
                $convert: { input: `$${p}`, to: 'objectId', onError: `$${p}` },
              },
            },
          },
        ]);
      }
    }

    for (const p of arrays) {
      const filter = { [p]: { $elemMatch: { $type: 'string' } } };
      const count = await model.countDocuments(filter);
      if (!count) continue;
      console.log(`${name}.${p}[]: ${count} row(s) with string entries`);
      totalConverted += count;
      if (apply) {
        await model.updateMany(filter, [
          {
            $set: {
              [p]: {
                $map: {
                  input: `$${p}`,
                  as: 'v',
                  in: {
                    $convert: { input: '$$v', to: 'objectId', onError: '$$v' },
                  },
                },
              },
            },
          },
        ]);
      }
    }
  }

  console.log(
    `\n${apply ? 'Converted' : 'Would convert'} ${totalConverted} row(s).` +
      (apply ? '' : ' Re-run with --apply to write.'),
  );
  await conn.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Keep the regex referenced so linters don't flag it; documents the id shape.
void HEX24;
