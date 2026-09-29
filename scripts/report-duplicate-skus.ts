// scripts/report-duplicate-skus.ts
//
// READ-ONLY audit: find SKUs that the new per-vendor uniqueness rule would
// reject. Writes nothing — run it before deploying that validation to learn
// whether it affects two products or two hundred.
//
// SKUs live on variants nested inside products (clothing.color_variants[].
// variants[].sku, accessory.variants[].sku, fabric.variants[].sku), so there is
// no single indexable path; products are walked in memory instead.
//
// Mirrors the server's rules exactly (products.service.ts assertSkusAreUnique):
//   - blank / missing SKUs are ignored — `sku` is optional and the consoles
//     default it to '', so empties are not duplicates
//   - comparison is case-insensitive
//   - scope is ONE VENDOR's catalogue; two vendors may share a code
//
// Usage:
//   npm run report:duplicate-skus            # summary
//   npm run report:duplicate-skus --verbose  # list every clashing variant
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

interface Occurrence {
  productId: string;
  productName: string;
  where: string;
}

async function run() {
  const verbose = process.argv.includes('--verbose');

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

  const cursor = products.find(
    {},
    {
      projection: {
        business: 1,
        'clothing.name': 1,
        'clothing.color_variants': 1,
        'accessory.name': 1,
        'accessory.variants': 1,
        'fabric.name': 1,
        'fabric.variants': 1,
      },
    },
  );

  // vendor → SKU (upper-cased) → every place it appears
  const byVendor = new Map<string, Map<string, Occurrence[]>>();
  let productCount = 0;
  let skuCount = 0;

  for await (const product of cursor) {
    productCount++;
    const vendor = String((product as any).business ?? 'unknown');
    const detail =
      (product as any).clothing ??
      (product as any).accessory ??
      (product as any).fabric ??
      {};
    const productName = detail.name ?? '(unnamed)';
    const productId = String((product as any)._id);

    const record = (raw: unknown, where: string) => {
      const sku = typeof raw === 'string' ? raw.trim() : '';
      if (!sku) return; // blanks are not duplicates
      skuCount++;
      const key = sku.toUpperCase();
      if (!byVendor.has(vendor)) byVendor.set(vendor, new Map());
      const forVendor = byVendor.get(vendor)!;
      if (!forVendor.has(key)) forVendor.set(key, []);
      forVendor.get(key)!.push({ productId, productName, where });
    };

    for (const colour of (product as any).clothing?.color_variants ?? []) {
      for (const variant of colour?.variants ?? []) {
        record(
          variant?.sku,
          `${colour?.name ?? 'colour'} / ${variant?.size ?? 'size'}`,
        );
      }
    }
    for (const variant of (product as any).accessory?.variants ?? []) {
      record(variant?.sku, variant?.size ?? 'variant');
    }
    for (const variant of (product as any).fabric?.variants ?? []) {
      record(variant?.sku, variant?.size ?? 'variant');
    }
  }

  // ── Report ──
  let vendorsAffected = 0;
  let clashingSkus = 0;
  let withinProduct = 0;
  let acrossProducts = 0;

  for (const [vendor, skus] of byVendor) {
    const duplicates = [...skus.entries()].filter(([, uses]) => uses.length > 1);
    if (!duplicates.length) continue;

    vendorsAffected++;
    clashingSkus += duplicates.length;
    console.log(`\nVendor ${vendor} — ${duplicates.length} duplicated SKU(s)`);

    for (const [sku, uses] of duplicates) {
      const distinctProducts = new Set(uses.map((u) => u.productId)).size;
      // Both are rejected, but a clash inside ONE product is the more urgent
      // signal: it means a generator produced the same code twice.
      if (distinctProducts > 1) acrossProducts++;
      else withinProduct++;

      const scope =
        distinctProducts > 1
          ? `across ${distinctProducts} products`
          : 'within one product';
      console.log(`  ${sku} — ${uses.length} uses, ${scope}`);

      if (verbose) {
        for (const use of uses) {
          console.log(`      ${use.productName} [${use.productId}] · ${use.where}`);
        }
      }
    }
  }

  console.log('\n──────────────────────────────────────────');
  console.log(`Products scanned      ${productCount}`);
  console.log(`Non-blank SKUs found  ${skuCount}`);
  console.log(`Vendors affected      ${vendorsAffected}`);
  console.log(`Duplicated SKUs       ${clashingSkus}`);
  console.log(`  within one product  ${withinProduct}`);
  console.log(`  across products     ${acrossProducts}`);

  if (!clashingSkus) {
    console.log('\n✅ No duplicates — the uniqueness rule will reject nothing.');
  } else {
    console.log(
      '\n⚠️  These vendors will hit a save error the next time they edit an\n' +
        '   affected product. Nothing breaks until then — existing products\n' +
        '   keep working and customers are unaffected.',
    );
    if (!verbose) console.log('   Re-run with --verbose to list every variant.');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
