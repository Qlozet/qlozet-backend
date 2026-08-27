// scripts/fix-sparse-indexes.ts
//
// One-off migration: replace the legacy non-sparse unique indexes on
// businesses.business_email, users.phone_number and users.username with the
// sparse ones the schemas now declare.
//
// Background: a non-sparse unique index indexes missing values as null, so a
// second document without the field collides with the first and Mongo raises
// E11000 on null. The schemas were changed to `sparse: true`, but an index
// already present in the database is never altered by Mongoose — it has to be
// dropped and rebuilt, which is what this does.
//
// This used to run in BusinessService.onModuleInit, i.e. on EVERY app boot. It
// could never converge: dropIndex removes `business_email_1`, then
// ensureIndexes recreates an index with that same auto-generated name, so the
// next boot dropped it again. Every restart therefore opened a window in which
// uniqueness was not enforced at all. Moved here so it runs deliberately, once.
//
// `username` needs an extra step: `sparse` skips documents where the field is
// absent, but NOT documents where it is explicitly null. Existing nulls are
// unset first, or the rebuilt index would collide on them immediately.
//
// Runs as a standalone Mongoose script (no Nest bootstrap), so it needs the
// same collection names Mongoose pluralises to.
//
// Usage:
//   npm run fix:sparse-indexes            # apply
//   npm run fix:sparse-indexes -- --dry   # report only, change nothing
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

// (collection, index name) pairs to drop so the sparse definition can be built.
const LEGACY_INDEXES: Array<{ collection: string; index: string }> = [
  { collection: 'businesses', index: 'business_email_1' },
  { collection: 'users', index: 'phone_number_1' },
  { collection: 'users', index: 'username_1' },
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

  try {
    // `sparse` does not skip explicit nulls, only missing fields.
    const users = mongoose.connection.collection('users');
    const nullUsernames = await users.countDocuments({ username: null });
    if (nullUsernames === 0) {
      console.log('• users.username: no null values to unset.');
    } else if (dryRun) {
      console.log(`🧪 users.username: would unset ${nullUsernames} null value(s).`);
    } else {
      const res = await users.updateMany(
        { username: null },
        { $unset: { username: '' } },
      );
      console.log(`✅ users.username: unset ${res.modifiedCount} null value(s).`);
    }

    for (const { collection, index } of LEGACY_INDEXES) {
      const coll = mongoose.connection.collection(collection);

      const existing = await coll.indexes();
      const found = existing.find((i) => i.name === index);

      if (!found) {
        console.log(`• ${collection}.${index}: not present, nothing to drop.`);
        continue;
      }
      if (found.sparse === true) {
        console.log(`• ${collection}.${index}: already sparse, leaving it.`);
        continue;
      }
      if (dryRun) {
        console.log(`🧪 ${collection}.${index}: would drop (non-sparse unique).`);
        continue;
      }

      await coll.dropIndex(index);
      console.log(`✅ ${collection}.${index}: dropped.`);
    }

    if (dryRun) {
      console.log('\n🧪 Dry run complete — nothing was changed.');
      console.log('Restart the app after applying: Mongoose rebuilds the');
      console.log('dropped indexes from the schema definitions, with sparse set.');
      return;
    }

    console.log('\n🎉 Done. Restart the app so Mongoose rebuilds the dropped');
    console.log('indexes from the schema definitions, this time with sparse.');
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
  }
}

run().catch((err) => {
  console.error('❌ Index fix failed:', err);
  process.exit(1);
});
