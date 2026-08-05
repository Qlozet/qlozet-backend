// scripts/normalize-objectid-refs.ts
//
// One-off migration: normalise ObjectId ref fields that were persisted as plain
// strings back into real ObjectIds.
//
// Root cause: ids coming off the JWT (`req.user.id`, `.id` off saved docs) are
// strings; several write paths stored them raw into ObjectId-typed ref fields.
// ObjectId-equality queries and Mongoose `populate()` silently miss string-typed
// values — e.g. a saved shipping address that bespoke "accept quote" couldn't
// find, or a freshly-created wallet the next lookup can't see (spawning dupes).
//
// The app-side fixes (cast on write) stop new bad data; this repairs existing
// documents. It converts only string-typed values that are valid 24-hex
// ObjectIds, in place, and skips anything else.
//
// Runs as a standalone Mongoose script (no Nest bootstrap).
//
// Usage:
//   npm run migrate:normalize-refs           # convert string refs → ObjectId
//   npm run migrate:normalize-refs -- --dry  # report only, change nothing
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

// (collection, field) pairs to normalise. Collection names are Mongoose's
// pluralised model names.
const TARGETS: Array<{ collection: string; field: string }> = [
  { collection: 'addresses', field: 'customer' },
  { collection: 'wallets', field: 'business' },
  { collection: 'wallets', field: 'customer' },
  { collection: 'transactions', field: 'initiator' },
  { collection: 'transactions', field: 'wallet' },
  { collection: 'transactions', field: 'order' },
  { collection: 'users', field: 'business' },
  { collection: 'teammembers', field: 'business' },
  { collection: 'teammembers', field: 'invited_by' },
];

async function run() {
  const dryRun = process.argv.includes('--dry');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log(`🔌 Connected to MongoDB.${dryRun ? ' (dry run)' : ''}`);

  let totalConverted = 0;
  let totalSkipped = 0;

  try {
    for (const { collection, field } of TARGETS) {
      const coll = mongoose.connection.collection(collection);

      // Documents whose `field` is a BSON string.
      const stringTyped = {
        $expr: { $eq: [{ $type: `$${field}` }, 'string'] },
      };
      const hexString = {
        $expr: { $regexMatch: { input: `$${field}`, regex: /^[0-9a-fA-F]{24}$/ } },
      };

      const affected = await coll.countDocuments(stringTyped);
      if (affected === 0) {
        console.log(`• ${collection}.${field}: nothing to fix.`);
        continue;
      }

      const convertible = await coll.countDocuments({
        $and: [stringTyped, hexString],
      });
      const skip = affected - convertible;
      if (skip > 0) {
        console.warn(
          `⚠️  ${collection}.${field}: ${skip} value(s) are non-24-hex strings — skipped.`,
        );
        totalSkipped += skip;
      }

      if (dryRun) {
        console.log(
          `🧪 ${collection}.${field}: would convert ${convertible} document(s).`,
        );
        totalConverted += convertible;
        continue;
      }

      const result = await coll.updateMany(
        { $and: [stringTyped, hexString] },
        [{ $set: { [field]: { $toObjectId: `$${field}` } } }],
      );
      console.log(
        `✅ ${collection}.${field}: converted ${result.modifiedCount} document(s).`,
      );
      totalConverted += result.modifiedCount;
    }

    console.log(
      `\n${dryRun ? '🧪 Dry run complete' : '🎉 Done'} — ${totalConverted} converted, ${totalSkipped} skipped.`,
    );
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
  }
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
