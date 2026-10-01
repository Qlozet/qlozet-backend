// scripts/drop-vendor-identity-numbers.ts
//
// Remove the raw NIN and BVN held on business records.
//
// The platform collected both, stored them in plaintext, excluded them from
// its own admin projection, and never read them: payouts run off
// transfer_recipient_code, and identity is established by QoreID, whose
// results are stored as a verdict, a provider reference, a verified name and a
// masked id - never the number itself.
//
// Removing the inputs stops new ones arriving; this removes what is already
// there, which is the half that actually reduces exposure. A BVN cannot be
// rotated after a leak the way a password can.
//
// This DELETES data and cannot be undone. Nothing reads these fields, so there
// is nothing to break - but run --dry first and take a backup if you want one.
//
// Usage:
//   npm run drop:identity-numbers -- --dry   # report only
//   npm run drop:identity-numbers            # apply
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
  const businesses = mongoose.connection.collection('businesses');

  const filter = {
    $or: [
      { nin: { $exists: true } },
      { bvn: { $exists: true } },
    ],
  };

  // Deliberately not printing the values. The point of the script is that
  // these numbers should not be lying around; echoing them into a terminal
  // scrollback or a CI log would defeat it.
  const affected = await businesses
    .find(filter, { projection: { business_name: 1, nin: 1, bvn: 1 } })
    .toArray();

  console.log(
    `${affected.length} vendor(s) hold a raw identity number.` +
      (dryRun ? ' (dry run - nothing will be written)' : ''),
  );

  for (const business of affected) {
    const held = [
      (business as any).nin ? 'NIN' : null,
      (business as any).bvn ? 'BVN' : null,
    ].filter(Boolean);
    console.log(
      `  ${(business as any).business_name ?? '(unnamed)'} ` +
        `[${business._id}] — ${held.join(' + ') || 'empty field only'}`,
    );
  }

  if (!dryRun && affected.length > 0) {
    const { modifiedCount } = await businesses.updateMany(filter, {
      $unset: { nin: '', bvn: '' },
    });
    console.log(`\n✅ Cleared ${modifiedCount} vendor record(s).`);
  } else if (dryRun && affected.length > 0) {
    console.log('\nRe-run without --dry to delete them.');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
