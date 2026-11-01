import { Model, Types } from 'mongoose';

/**
 * An order's `vendor_earnings` and `platform_commission` are a copy of its
 * earning rows (net_amount and commission summed). Every path that creates,
 * reduces or deletes an earning row calls this afterwards, so the order never
 * drifts from the rows — before, only a full cancellation reset them, and a
 * return, rejection, dispute refund or penalty left the order showing money
 * that had gone back to the customer.
 */
export async function syncOrderEarningTotals(
  orderModel: Model<any>,
  earningsModel: Model<any>,
  orderId: Types.ObjectId | string,
): Promise<{ vendor_earnings: number; platform_commission: number }> {
  const id = new Types.ObjectId(String(orderId));
  const [row] = await earningsModel.aggregate([
    { $match: { order: id } },
    {
      $group: {
        _id: null,
        net: { $sum: { $ifNull: ['$net_amount', 0] } },
        commission: { $sum: { $ifNull: ['$commission', 0] } },
      },
    },
  ]);
  const totals = {
    vendor_earnings: round2(row?.net ?? 0),
    platform_commission: round2(row?.commission ?? 0),
  };
  await orderModel.updateOne({ _id: id }, { $set: totals });
  return totals;
}

/**
 * Take `take` off an earning row's net. When the reduction is money going
 * back to the customer (a return or refund), the platform gives up the same
 * share of its commission, so the commission shrinks in proportion; a penalty
 * is the vendor's cost alone and leaves the commission as it was.
 */
export function reduceEarning(
  earning: { net_amount?: number; commission?: number },
  take: number,
  opts: { refund: boolean },
): void {
  const net = earning.net_amount || 0;
  const next = Math.max(0, net - take);
  if (opts.refund && net > 0) {
    earning.commission = round2((earning.commission || 0) * (next / net));
  }
  earning.net_amount = round2(next);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
