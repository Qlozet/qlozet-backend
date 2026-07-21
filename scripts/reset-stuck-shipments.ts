// scripts/reset-stuck-shipments.ts
//
// One-off cleanup: reset shipments left stuck in 'ready_to_ship' with no
// tracking number back to 'pending'.
//
// Background: fulfillment atomically claims a shipment as 'ready_to_ship'
// before calling Shipbubble. If the label call failed (before the revert guard
// was added), the shipment stayed 'ready_to_ship' — and the vendor UI only
// shows the Fulfill button for 'pending' shipments, so it was un-retryable.
// A successful fulfill always moves a shipment to 'shipped' WITH a tracking
// number, so any 'ready_to_ship' shipment without one is a failed attempt.
//
// Runs as a standalone Mongoose script (no Nest bootstrap) — only needs a Mongo
// connection.
//
// Usage:
//   npm run reset:stuck-shipments -- --dry-run   # preview, no writes
//   npm run reset:stuck-shipments                # apply the reset
//
import * as dotenv from 'dotenv';
import * as mongoose from 'mongoose';

dotenv.config();

async function run() {
  const dryRun = process.argv
    .slice(2)
    .some((a) => a === '--dry-run' || a === 'dry');

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is not set in the environment (.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('🔌 Connected to MongoDB.');

  try {
    const collection = mongoose.connection.collection('orders');

    // Stuck = a shipment in 'ready_to_ship' with no tracking number.
    // (`tracking_number: null` matches both null and missing fields.)
    const filter = {
      shipments: {
        $elemMatch: { status: 'ready_to_ship', tracking_number: null },
      },
    };

    const affected = await collection
      .find(filter, { projection: { reference: 1, shipments: 1 } })
      .toArray();

    if (affected.length === 0) {
      console.log(
        'ℹ️  No stuck shipments found (none in ready_to_ship without a tracking number).',
      );
      return;
    }

    let stuckCount = 0;
    for (const o of affected) {
      const stuck = (o.shipments || []).filter(
        (s: any) => s.status === 'ready_to_ship' && s.tracking_number == null,
      );
      stuckCount += stuck.length;
      console.log(`  • order ${o.reference}: ${stuck.length} stuck shipment(s)`);
    }

    console.log(
      `📋 Found ${stuckCount} stuck shipment(s) across ${affected.length} order(s).`,
    );

    if (dryRun) {
      console.log(
        '🧪 Dry run — no changes written. Re-run without --dry-run to apply.',
      );
      return;
    }

    const result = await collection.updateMany(filter, {
      $set: { 'shipments.$[s].status': 'pending' },
    } as any, {
      arrayFilters: [{ 's.status': 'ready_to_ship', 's.tracking_number': null }],
    });

    console.log(
      `✅ Reset stuck shipments in ${result.modifiedCount} order(s) → 'pending' (Fulfill button restored, retryable).`,
    );
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
  }
}

run().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
