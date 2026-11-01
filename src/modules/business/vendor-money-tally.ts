/**
 * Does vendor money add up? Four records describe the same money and must
 * agree:
 *
 *  - earning rows (BusinessEarning): what each vendor earned per order
 *  - the order: vendor_earnings / platform_commission, a copy of its rows
 *  - the vendor wallet: pending_balance (unreleased rows) and balance
 *  - the wallet's transaction history: every movement of balance
 *
 * Pure: the caller loads the records, this compares them. Differences under
 * a naira are rounding and are ignored.
 */

export const TALLY_TOLERANCE = 1;

export interface TallyWallet {
  wallet_id: string;
  business_id: string;
  business_name?: string | null;
  balance: number;
  pending_balance: number;
  owed_balance: number;
}

/** Per business: the sum of net_amount on rows not yet released. */
export type UnreleasedByBusiness = Map<string, number>;

/**
 * Per wallet: successful money in and out, by transaction type. A payout
 * debit counts while pending too (the wallet is debited when it is
 * requested; a failed transfer is marked failed and the money credited back).
 */
export interface LedgerSums {
  fund: number;
  credit: number;
  debit: number;
  refund: number;
}

export interface TallyOrder {
  order_id: string;
  reference?: string | null;
  status?: string | null;
  payment_status?: string | null;
  vendor_earnings: number;
  platform_commission: number;
  /** Summed from the order's earning rows. */
  rows: number;
  rows_net: number;
  rows_commission: number;
}

export interface VendorMoneyTally {
  vendors_checked: number;
  orders_checked: number;
  pending_mismatch: {
    business: string;
    business_id: string;
    wallet_pending: number;
    unreleased_earnings: number;
    difference: number;
  }[];
  balance_mismatch: {
    business: string;
    business_id: string;
    wallet_balance: number;
    history_balance: number;
    difference: number;
    owed_balance: number;
  }[];
  order_totals_mismatch: {
    order: string;
    status: string | null;
    order_vendor_earnings: number;
    rows_net: number;
    order_commission: number;
    rows_commission: number;
  }[];
  paid_without_earnings: { order: string; status: string | null }[];
  released_without_history: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const off = (a: number, b: number) => Math.abs(r2(a) - r2(b)) >= TALLY_TOLERANCE;

/** What the history says the balance should be. */
export const historyBalance = (l: LedgerSums | undefined): number =>
  r2((l?.fund ?? 0) + (l?.credit ?? 0) - (l?.debit ?? 0) - (l?.refund ?? 0));

/** Orders whose money never reaches a vendor, so no earning rows is right. */
const NO_EARNINGS_STATUSES = new Set(['cancelled', 'refunded']);

export function tallyVendorMoney(input: {
  wallets: TallyWallet[];
  unreleased: UnreleasedByBusiness;
  ledger: Map<string, LedgerSums>;
  orders: TallyOrder[];
  releasedWithoutHistory?: number;
}): VendorMoneyTally {
  const out: VendorMoneyTally = {
    vendors_checked: input.wallets.length,
    orders_checked: input.orders.length,
    pending_mismatch: [],
    balance_mismatch: [],
    order_totals_mismatch: [],
    paid_without_earnings: [],
    released_without_history: input.releasedWithoutHistory ?? 0,
  };

  for (const w of input.wallets) {
    const name = w.business_name || w.business_id;
    const unreleased = r2(input.unreleased.get(w.business_id) ?? 0);
    if (off(w.pending_balance, unreleased)) {
      out.pending_mismatch.push({
        business: name,
        business_id: w.business_id,
        wallet_pending: r2(w.pending_balance),
        unreleased_earnings: unreleased,
        difference: r2(w.pending_balance - unreleased),
      });
    }
    const history = historyBalance(input.ledger.get(w.wallet_id));
    if (off(w.balance, history)) {
      out.balance_mismatch.push({
        business: name,
        business_id: w.business_id,
        wallet_balance: r2(w.balance),
        history_balance: history,
        difference: r2(w.balance - history),
        owed_balance: r2(w.owed_balance),
      });
    }
  }

  for (const o of input.orders) {
    const ref = o.reference || o.order_id;
    if (
      off(o.vendor_earnings, o.rows_net) ||
      off(o.platform_commission, o.rows_commission)
    ) {
      out.order_totals_mismatch.push({
        order: ref,
        status: o.status ?? null,
        order_vendor_earnings: r2(o.vendor_earnings),
        rows_net: r2(o.rows_net),
        order_commission: r2(o.platform_commission),
        rows_commission: r2(o.rows_commission),
      });
    }
    if (
      o.payment_status === 'paid' &&
      o.rows === 0 &&
      !NO_EARNINGS_STATUSES.has(String(o.status ?? ''))
    ) {
      out.paid_without_earnings.push({ order: ref, status: o.status ?? null });
    }
  }

  const byGap = (a: { difference: number }, b: { difference: number }) =>
    Math.abs(b.difference) - Math.abs(a.difference);
  out.pending_mismatch.sort(byGap);
  out.balance_mismatch.sort(byGap);
  return out;
}
