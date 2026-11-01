import { historyBalance, tallyVendorMoney } from './vendor-money-tally';
import { reduceEarning, syncOrderEarningTotals } from './order-earning-totals';

/**
 * Orders, earning rows, wallets and the transaction history describe the
 * same vendor money; the tally lists where they disagree.
 */
describe('Vendor money tally', () => {
  const wallet = (patch: any = {}) => ({
    wallet_id: 'w1',
    business_id: 'b1',
    business_name: 'Ada Tailors',
    balance: 0,
    pending_balance: 0,
    owed_balance: 0,
    ...patch,
  });

  it('is clean when every record agrees', () => {
    const t = tallyVendorMoney({
      // 50k released, 10k withdrawn, 2k clawed back for a return -> 38k
      wallets: [wallet({ balance: 38000, pending_balance: 9000 })],
      unreleased: new Map([['b1', 9000]]),
      ledger: new Map([['w1', { fund: 0, credit: 50000, debit: 10000, refund: 2000 }]]),
      orders: [
        {
          order_id: 'o1',
          reference: 'QLZ-1',
          status: 'completed',
          payment_status: 'paid',
          vendor_earnings: 9000,
          platform_commission: 1000,
          rows: 1,
          rows_net: 9000,
          rows_commission: 1000,
        },
      ],
    });
    expect(t.pending_mismatch).toEqual([]);
    expect(t.balance_mismatch).toEqual([]);
    expect(t.order_totals_mismatch).toEqual([]);
    expect(t.paid_without_earnings).toEqual([]);
  });

  it('flags a balance the history does not explain (a clawback with no entry)', () => {
    const t = tallyVendorMoney({
      wallets: [wallet({ balance: 38000 })],
      unreleased: new Map(),
      ledger: new Map([['w1', { fund: 0, credit: 50000, debit: 10000, refund: 0 }]]),
      orders: [],
    });
    expect(t.balance_mismatch).toEqual([
      expect.objectContaining({ wallet_balance: 38000, history_balance: 40000, difference: -2000 }),
    ]);
  });

  it('flags pending earnings that drifted from the unreleased rows', () => {
    const t = tallyVendorMoney({
      wallets: [wallet({ pending_balance: 12000 })],
      unreleased: new Map([['b1', 9000]]),
      ledger: new Map(),
      orders: [],
    });
    expect(t.pending_mismatch[0]).toMatchObject({ difference: 3000, business: 'Ada Tailors' });
  });

  it('flags order totals that disagree with the rows, and paid orders with no earnings', () => {
    const base = { payment_status: 'paid', platform_commission: 0, rows_commission: 0 };
    const t = tallyVendorMoney({
      wallets: [],
      unreleased: new Map(),
      ledger: new Map(),
      orders: [
        { ...base, order_id: 'o1', reference: 'QLZ-1', status: 'returned', vendor_earnings: 9000, rows: 1, rows_net: 4500 },
        { ...base, order_id: 'o2', reference: 'QLZ-2', status: 'processing', vendor_earnings: 0, rows: 0, rows_net: 0 },
        // A cancelled order rightly has no earnings left.
        { ...base, order_id: 'o3', reference: 'QLZ-3', status: 'cancelled', vendor_earnings: 0, rows: 0, rows_net: 0 },
      ],
    });
    expect(t.order_totals_mismatch.map((o) => o.order)).toEqual(['QLZ-1']);
    expect(t.paid_without_earnings).toEqual([{ order: 'QLZ-2', status: 'processing' }]);
  });

  it('ignores differences under a naira', () => {
    const t = tallyVendorMoney({
      wallets: [wallet({ balance: 100.4 })],
      unreleased: new Map(),
      ledger: new Map([['w1', { fund: 100, credit: 0, debit: 0, refund: 0 }]]),
      orders: [],
    });
    expect(t.balance_mismatch).toEqual([]);
    expect(historyBalance(undefined)).toBe(0);
  });
});

describe('Earning reductions and order totals', () => {
  it('a refund shrinks the commission in proportion; a penalty does not', () => {
    const refunded = { net_amount: 9000, commission: 1000 };
    reduceEarning(refunded, 4500, { refund: true });
    expect(refunded).toEqual({ net_amount: 4500, commission: 500 });

    const penalised = { net_amount: 9000, commission: 1000 };
    reduceEarning(penalised, 2000, { refund: false });
    expect(penalised).toEqual({ net_amount: 7000, commission: 1000 });

    const over = { net_amount: 1000, commission: 100 };
    reduceEarning(over, 5000, { refund: true });
    expect(over).toEqual({ net_amount: 0, commission: 0 });
  });

  it('copies the summed rows onto the order', async () => {
    const updates: any[] = [];
    const orderModel: any = { updateOne: async (q: any, u: any) => updates.push([q, u]) };
    const earningsModel: any = { aggregate: async () => [{ net: 13500.004, commission: 1500 }] };
    const totals = await syncOrderEarningTotals(orderModel, earningsModel, '6aa96c26ef5fdeff8d35d63b');
    expect(totals).toEqual({ vendor_earnings: 13500, platform_commission: 1500 });
    expect(updates[0][1]).toEqual({ $set: totals });
  });

  it('zeroes the order when no rows are left', async () => {
    const orderModel: any = { updateOne: async () => undefined };
    const earningsModel: any = { aggregate: async () => [] };
    expect(await syncOrderEarningTotals(orderModel, earningsModel, '6aa96c26ef5fdeff8d35d63b')).toEqual({
      vendor_earnings: 0,
      platform_commission: 0,
    });
  });
});
