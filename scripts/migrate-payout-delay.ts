// scripts/migrate-payout-delay.ts
//
// One-off migration: align stored PlatformSettings.payout_delay_days with the
// new default (3). The code default only applies to freshly-created settings
// documents, so any existing document created with the old value of 7 must be
// updated here.
//
// Runs as a standalone Mongoose script (no Nest bootstrap) so it only needs a
// Mongo connection — nothing else in the app has to start.
//
// Usage:
//   npm run migrate:payout-delay          # sets payout_delay_days = 3
//   npm run migrate:payout-delay 5        # sets a custom value
//
import * as dotenv from 'dotenv';
import * as mongoose from 'mongoose';

dotenv.config();

async function run() {
  const target = Number(process.argv[2] ?? 3);

  if (!Number.isFinite(target) || target < 0) {
    console.error(`❌ Invalid payout_delay_days value: "${process.argv[2]}"`);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('🔌 Connected to MongoDB.');

  try {
    // PlatformSettings has no custom collection name, so Mongoose pluralises
    // the model name → "platformsettings".
    const collection = mongoose.connection.collection('platformsettings');

    const existing = await collection
      .find({}, { projection: { payout_delay_days: 1 } })
      .toArray();

    if (existing.length === 0) {
      console.log(
        'ℹ️  No PlatformSettings document found. Nothing to migrate ' +
          `(new documents will use the code default of ${target}).`,
      );
      return;
    }

    console.log(
      `📋 Found ${existing.length} settings document(s). Current payout_delay_days: ` +
        existing.map((d) => d.payout_delay_days).join(', '),
    );

    const result = await collection.updateMany(
      { payout_delay_days: { $ne: target } },
      { $set: { payout_delay_days: target } },
    );

    console.log(
      `✅ Updated ${result.modifiedCount} document(s) → payout_delay_days = ${target}.`,
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
