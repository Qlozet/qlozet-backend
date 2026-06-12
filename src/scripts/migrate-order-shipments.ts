/**
 * One-time migration script: move root-level tracking data into VendorShipment entries.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-order-shipments.ts
 *
 * This script:
 * 1. Finds all orders with tracking_number or courier_name at root level
 * 2. Creates a VendorShipment entry from those root fields
 * 3. Sets shipment.business from items[0].business (best guess for single-vendor orders)
 */

import { connect, model, Schema, Types } from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

// Use a permissive schema for migration — we access arbitrary fields
const OrderSchema = new Schema({}, { strict: false, collection: 'orders' });
const OrderModel = model('Order', OrderSchema);

async function migrate() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGODB_URI or MONGO_URI env variable is required');
    process.exit(1);
  }

  await connect(mongoUri);
  console.log('Connected to MongoDB');

  // Find orders with root-level tracking data but no shipments yet
  const ordersToMigrate: any[] = await OrderModel.find({
    $and: [
      {
        $or: [
          { tracking_number: { $exists: true, $nin: [null, ''] } },
          { courier_name: { $exists: true, $nin: [null, ''] } },
        ],
      },
      {
        $or: [
          { shipments: { $exists: false } },
          { shipments: { $size: 0 } },
        ],
      },
    ],
  }).lean();

  console.log(`Found ${ordersToMigrate.length} orders to migrate`);

  let migrated = 0;
  let skipped = 0;

  for (const order of ordersToMigrate) {
    try {
      // Get business from first item
      const businessId = order.items?.[0]?.business || null;

      if (!businessId) {
        console.log(
          `  SKIP: Order ${order.reference || order._id} — no business on items`,
        );
        skipped++;
        continue;
      }

      const shipment: any = {
        _id: new Types.ObjectId(),
        business: businessId,
        tracking_number: order.tracking_number || undefined,
        courier_name: order.courier_name || undefined,
        shipping_fee: order.shipping_fee || 0,
        status:
          order.status === 'completed'
            ? 'delivered'
            : order.status === 'in_transit'
              ? 'in_transit'
              : order.status === 'processing'
                ? 'shipped'
                : 'pending',
      };

      if (order.status === 'completed') {
        shipment.delivered_at = order.updatedAt || new Date();
      }

      await OrderModel.updateOne(
        { _id: order._id },
        { $set: { shipments: [shipment] } },
      );

      console.log(
        `  OK: Order ${order.reference || order._id} — created shipment for business ${businessId}`,
      );
      migrated++;
    } catch (err: any) {
      console.error(
        `  ERROR: Order ${order.reference || order._id} — ${err.message}`,
      );
      skipped++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
