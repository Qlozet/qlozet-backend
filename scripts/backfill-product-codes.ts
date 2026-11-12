// scripts/backfill-product-codes.ts
//
// Gives every product without one the short code in its shop address
// (shop.qlozet.app/p/<name>-<code>). New products get theirs when created;
// this is for the ones made before. Safe to run again: products that have a
// code are skipped. Until it runs, those products still open at /products/<id>.
//
// Usage:
//   npm run backfill:product-codes -- --dry   # report only
//   npm run backfill:product-codes            # apply
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';
import { newProductCode } from '../src/modules/products/product-code';

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
  const products = mongoose.connection.collection('products');

  const missing = await products
    .find(
      { $or: [{ code: { $exists: false } }, { code: null }, { code: '' }] },
      { projection: { _id: 1 } },
    )
    .toArray();

  console.log(
    `${missing.length} product(s) without an address code.` +
      (dryRun ? ' (dry run - nothing will be written)' : ''),
  );

  if (!dryRun) {
    let done = 0;
    for (const product of missing) {
      // A random clash with an existing code is about one in a trillion; the
      // unique index rejects it and the next code is tried.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await products.updateOne(
            {
              _id: product._id,
              $or: [{ code: { $exists: false } }, { code: null }, { code: '' }],
            },
            { $set: { code: newProductCode() } },
          );
          if (res.modifiedCount) done++;
          break;
        } catch (err: any) {
          if (err?.code !== 11000 || attempt === 4) throw err;
        }
      }
      if (done && done % 500 === 0) console.log(`  ${done} done…`);
    }
    console.log(`\nGave ${done} product(s) an address code.`);
  } else if (missing.length) {
    console.log('\nRe-run without --dry to apply.');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
