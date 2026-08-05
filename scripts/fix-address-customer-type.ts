// scripts/fix-address-customer-type.ts
//
// One-off migration: normalise Address.customer from a plain string to a real
// ObjectId.
//
// Some address documents were saved with `customer` stored as a string instead
// of an ObjectId. ObjectId-equality queries (populate, and the bespoke
// "accept quote" address lookup) silently miss those docs, so a customer who
// clearly has a saved address gets "Please add a shipping address" anyway.
//
// This converts every string-typed customer to an ObjectId in place, touching
// only the malformed documents. The app-side fix (users.service.addAddress now
// casts explicitly) stops new ones from being created; this repairs old data.
//
// Runs as a standalone Mongoose script (no Nest bootstrap) so it only needs a
// Mongo connection.
//
// Usage:
//   npm run migrate:address-customer          # convert string customers → ObjectId
//   npm run migrate:address-customer -- --dry # report only, change nothing
//
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function run() {
  const dryRun = process.argv.includes('--dry');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('🔌 Connected to MongoDB.');

  try {
    // Address has no custom collection name → Mongoose pluralises to "addresses".
    const collection = mongoose.connection.collection('addresses');

    // Only documents whose `customer` is a BSON string need fixing.
    const stringTyped = { $expr: { $eq: [{ $type: '$customer' }, 'string'] } };

    const affected = await collection.countDocuments(stringTyped);
    const total = await collection.estimatedDocumentCount();
    console.log(
      `📋 ${total} address document(s) total; ${affected} have a string-typed customer.`,
    );

    if (affected === 0) {
      console.log('✅ Nothing to migrate — all customer fields are ObjectIds.');
      return;
    }

    // Guard: a string that isn't a valid 24-hex ObjectId can't be converted and
    // would abort the whole pipeline. Report any such docs and skip them.
    const invalid = await collection
      .find(
        {
          $and: [
            stringTyped,
            { $expr: { $not: { $regexMatch: { input: '$customer', regex: /^[0-9a-fA-F]{24}$/ } } } },
          ],
        },
        { projection: { _id: 1, customer: 1 } },
      )
      .toArray();

    if (invalid.length > 0) {
      console.warn(
        `⚠️  ${invalid.length} document(s) have a non-ObjectId string customer and will be skipped:`,
      );
      invalid.forEach((d) => console.warn(`     _id=${d._id} customer=${JSON.stringify(d.customer)}`));
    }

    if (dryRun) {
      console.log(
        `🧪 Dry run — would convert ${affected - invalid.length} document(s). No changes made.`,
      );
      return;
    }

    // Convert only the valid 24-hex string customers to ObjectId in place.
    const result = await collection.updateMany(
      {
        $and: [
          stringTyped,
          { $expr: { $regexMatch: { input: '$customer', regex: /^[0-9a-fA-F]{24}$/ } } },
        ],
      },
      [{ $set: { customer: { $toObjectId: '$customer' } } }],
    );

    console.log(
      `✅ Converted ${result.modifiedCount} document(s): customer string → ObjectId.`,
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
