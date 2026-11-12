// scripts/backfill-store-slugs.ts
//
// Gives every store without a shop address (shop.qlozet.app/s/<slug>) one made
// from its name. New stores get theirs at sign-up; this is for the ones made
// before addresses existed. Safe to run again: stores that have an address are
// skipped, and a vendor opening Settings → Store address gets one anyway.
//
// Oldest stores go first, so when two share a name the first one registered
// gets the plain address and the later one gets "-2".
//
// Usage:
//   npm run backfill:store-slugs -- --dry   # report only
//   npm run backfill:store-slugs            # apply
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  ensureStoreSlug,
  freeSlugFor,
  slugOwnerFilter,
} from '../src/modules/business/store-slug';

dotenv.config();

async function run() {
  const dryRun = process.argv.includes('--dry');

  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;
  if (!uri) {
    console.error('MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const businesses = mongoose.connection.collection('businesses');

  const missing = await businesses
    .find(
      { $or: [{ slug: { $exists: false } }, { slug: null }, { slug: '' }] },
      { projection: { business_name: 1, slug: 1 } },
    )
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  console.log(
    `${missing.length} store(s) without an address.` +
      (dryRun ? ' (dry run - nothing will be written)' : ''),
  );

  // In a dry run nothing is written, so remember the planned ones too or two
  // stores with the same name would both be shown the plain address.
  const planned = new Set<string>();
  let done = 0;
  for (const business of missing) {
    // An empty-string slug would block the sparse unique index for everyone.
    if (business.slug === '') {
      if (!dryRun) {
        await businesses.updateOne({ _id: business._id }, { $unset: { slug: '' } });
      }
      business.slug = undefined;
    }

    let slug: string;
    if (dryRun) {
      slug = await freeSlugFor(
        business.business_name,
        async (s) =>
          planned.has(s) || !!(await businesses.findOne(slugOwnerFilter(s))),
      );
      planned.add(slug);
    } else {
      slug = await ensureStoreSlug(businesses as any, business as any);
    }
    done++;
    console.log(`  ${business.business_name ?? '(unnamed)'} [${business._id}] -> /s/${slug}`);
  }

  console.log(dryRun ? `\nRe-run without --dry to apply.` : `\nGave ${done} store(s) an address.`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
