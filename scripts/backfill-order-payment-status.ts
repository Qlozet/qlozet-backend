// scripts/backfill-order-payment-status.ts
//
// One-off backfill: derive the new denormalised Order.payment_status /
// refund_status from existing Transaction records.
//
//   payment_status = 'paid'      -> a successful checkout/wallet_checkout txn exists
//   refund_status  = 'refunded'  -> a refund txn exists AND the order is cancelled
//   refund_status  = 'partial'   -> a refund txn exists AND the order is NOT cancelled
//
// Going forward these are set inline at the payment/refund sites; this repairs
// history. Assumes transactions.order refs are ObjectIds (run
// migrate:normalize-refs first if unsure).
//
// Usage:
//   npm run backfill:order-payment            # apply
//   npm run backfill:order-payment -- --dry   # report only
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
  console.log(`🔌 Connected to MongoDB.${dryRun ? ' (dry run)' : ''}`);

  try {
    const orders = mongoose.connection.collection('orders');
    const txns = mongoose.connection.collection('transactions');

    const paidOrderIds = await txns.distinct('order', {
      status: 'success',
      channel: { $in: ['checkout', 'wallet_checkout'] },
    });
    const refundOrderIds = await txns.distinct('order', {
      $or: [{ type: 'refund' }, { channel: 'refund' }],
    });

    console.log(
      `📋 ${paidOrderIds.length} order(s) have a successful payment; ` +
        `${refundOrderIds.length} have a refund.`,
    );

    if (dryRun) {
      const refundedCount = await orders.countDocuments({
        _id: { $in: refundOrderIds as any[] },
        status: 'cancelled',
      });
      console.log(
        `🧪 Would set payment_status='paid' on ${paidOrderIds.length}, ` +
          `refund_status='refunded' on ${refundedCount}, ` +
          `refund_status='partial' on ${refundOrderIds.length - refundedCount}.`,
      );
      return;
    }

    const paid = await orders.updateMany(
      { _id: { $in: paidOrderIds as any[] } },
      { $set: { payment_status: 'paid' } },
    );
    const refunded = await orders.updateMany(
      { _id: { $in: refundOrderIds as any[] }, status: 'cancelled' },
      { $set: { refund_status: 'refunded' } },
    );
    const partial = await orders.updateMany(
      { _id: { $in: refundOrderIds as any[] }, status: { $ne: 'cancelled' } },
      { $set: { refund_status: 'partial' } },
    );

    console.log(
      `✅ payment_status='paid': ${paid.modifiedCount}; ` +
        `refund_status='refunded': ${refunded.modifiedCount}; ` +
        `refund_status='partial': ${partial.modifiedCount}.`,
    );
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected.');
  }
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
