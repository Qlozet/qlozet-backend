/**
 * One-time migration: reset every vendor's daily order limit to 0 (unlimited).
 *
 * Background: `daily_order_limit` sat on the vendor settings page for a long
 * time without the backend ever reading it. Vendors could set "20" and nothing
 * happened. Now that checkout actually enforces the cap, any stale value would
 * silently start turning customers away at a threshold the vendor chose back
 * when the control was decorative — and never revisited.
 *
 * Resetting to 0 means the limit only applies to vendors who set it
 * deliberately from here on. Nothing else about their settings is touched.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/reset-daily-order-limit.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register src/scripts/reset-daily-order-limit.ts --apply  # write
 *
 * Reads MONGO_URI (falls back to MONGODB_URI / DATABASE_URL). Safe to re-run:
 * once reset, no document matches `daily_order_limit: { $gt: 0 }`.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');

async function main() {
  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;
  if (!uri) {
    console.error(
      'No MONGO_URI (or MONGODB_URI / DATABASE_URL) found in the environment.',
    );
    process.exit(1);
  }

  await mongoose.connect(uri);
  const businesses = mongoose.connection.collection('businesses');

  const affected = await businesses
    .find(
      { daily_order_limit: { $gt: 0 } },
      { projection: { business_name: 1, daily_order_limit: 1 } },
    )
    .toArray();

  if (!affected.length) {
    console.log('Nothing to do — no vendor has a non-zero daily order limit.');
    await mongoose.disconnect();
    return;
  }

  console.log(
    `${affected.length} vendor(s) carry a stale daily order limit:\n`,
  );
  for (const biz of affected) {
    console.log(
      `  ${String(biz.business_name ?? biz._id)} — limit ${biz.daily_order_limit}`,
    );
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry run. Re-run with --apply to reset these to 0.');
    await mongoose.disconnect();
    return;
  }

  const res = await businesses.updateMany(
    { daily_order_limit: { $gt: 0 } },
    { $set: { daily_order_limit: 0 } },
  );
  console.log(`Reset ${res.modifiedCount} vendor(s) to unlimited (0).`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
