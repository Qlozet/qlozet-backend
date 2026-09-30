// scripts/migrate-accessory-variant-size.ts
//
// Accessory variants used to declare `size` as an ARRAY of strings, while the
// DTO, the vendor console and the shop all send and read a single string. The
// schema now says String - which means a legacy row holding ["M"] cannot be
// cast and reads back as undefined, so the variant silently loses its size.
//
// This flattens those arrays to their first entry. Products written since the
// schema change already hold a string and are left alone.
//
// Usage:
//   npm run migrate:accessory-variant-size -- --dry   # report only
//   npm run migrate:accessory-variant-size            # apply
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
  const products = mongoose.connection.collection('products');

  // The raw driver, deliberately: going through the model would apply the new
  // schema and drop the very arrays this needs to read.
  const affected = await products
    .find({ 'accessory.variants.size': { $type: 'array' } })
    .toArray();

  console.log(
    `${affected.length} accessory product(s) hold an array size.` +
      (dryRun ? ' (dry run - nothing will be written)' : ''),
  );

  let variantsFixed = 0;
  let cleared = 0;

  for (const product of affected) {
    const variants = (product as any).accessory?.variants ?? [];
    const next = variants.map((variant: any) => {
      if (!Array.isArray(variant?.size)) return variant;
      variantsFixed++;
      // An empty array carries no size at all - drop the field rather than
      // invent one, so the variant reads as size-less instead of size "".
      const [first] = variant.size;
      if (first === undefined) {
        cleared++;
        const { size, ...rest } = variant;
        return rest;
      }
      return { ...variant, size: String(first) };
    });

    console.log(
      `  ${(product as any).accessory?.name ?? '(unnamed)'} [${product._id}] — ` +
        `${variants.length} variant(s)`,
    );

    if (!dryRun) {
      await products.updateOne(
        { _id: product._id },
        { $set: { 'accessory.variants': next } },
      );
    }
  }

  console.log('\n──────────────────────────────────────────');
  console.log(`Products ${dryRun ? 'to update' : 'updated'}   ${affected.length}`);
  console.log(`Variants flattened   ${variantsFixed}`);
  if (cleared) console.log(`  empty, size removed  ${cleared}`);
  if (dryRun && affected.length) console.log('\nRe-run without --dry to apply.');

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
