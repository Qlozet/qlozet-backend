// scripts/backfill-accepts-bespoke.ts
//
// `accepts_bespoke` defaults to TRUE so that turning the field on changes
// nothing: every business could be sent a quote request before, and still can.
// That keeps existing tailors working, but it also leaves the original problem
// in place for shops that plainly do not sew.
//
// This turns the flag OFF for businesses with no evidence of tailoring:
//   - no clothing product in their catalogue (any status), AND
//   - no bespoke quote ever addressed to them
//
// Both halves matter. A tailor between collections may have an empty
// catalogue, and a new tailor may have no quotes yet - only a business with
// neither has never done this work. Vendors can switch it back on themselves
// in settings, so the cost of a wrong guess is one toggle, not lost business.
//
// Usage:
//   npm run backfill:accepts-bespoke -- --dry   # report only
//   npm run backfill:accepts-bespoke            # apply
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function run() {
  const dryRun = process.argv.includes('--dry');

  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection;

  const businesses = await db
    .collection('businesses')
    .find({}, { projection: { business_name: 1, accepts_bespoke: 1 } })
    .toArray();

  // One round trip each rather than one per vendor.
  const tailoringIds = new Set(
    (
      await db.collection('products').distinct('business', {
        kind: 'clothing',
      })
    ).map(String),
  );
  const quotedIds = new Set(
    (await db.collection('bespokequotes').distinct('vendor')).map(String),
  );

  const toDisable = businesses.filter((b) => {
    if (b.accepts_bespoke === false) return false; // already off
    const id = String(b._id);
    return !tailoringIds.has(id) && !quotedIds.has(id);
  });

  console.log(
    `${businesses.length} vendor(s): ${tailoringIds.size} list clothing, ` +
      `${quotedIds.size} have been quoted.`,
  );
  console.log(
    `${toDisable.length} with neither will have accepts_bespoke turned off.` +
      (dryRun ? ' (dry run — nothing will be written)' : ''),
  );

  for (const business of toDisable) {
    console.log(`  ${business.business_name ?? '(unnamed)'} [${business._id}]`);
  }

  if (!dryRun && toDisable.length > 0) {
    const { modifiedCount } = await db.collection('businesses').updateMany(
      { _id: { $in: toDisable.map((b) => b._id) } },
      { $set: { accepts_bespoke: false } },
    );
    console.log(`\n✅ Updated ${modifiedCount} vendor(s).`);
  } else if (dryRun && toDisable.length > 0) {
    console.log('\nRe-run without --dry to apply.');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
