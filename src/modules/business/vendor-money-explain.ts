/**
 * One vendor whose money does not tally: which records cause the difference.
 *
 * The tally (vendor-money-tally.ts) says a wallet disagrees with its history
 * or its earning rows. This walks that vendor's records and names the known
 * causes, each with the amount it accounts for and whether it happened before
 * the fix for it shipped. Whatever is left is "unexplained" and is the part
 * worth worrying about.
 *
 * Pure: the caller loads the records.
 */

import { historyBalance, LedgerSums } from './vendor-money-tally';

/** Bugs that left records out of step, by the date their fix shipped. */
export const MONEY_FIXES = {
  ledger: { date: '2026-07-31', what: 'Before this, a payout was taken from the wallet twice and logged without the wallet, and released earnings wrote no history entry.' },
  duplicatePayout: { date: '2026-08-16', what: 'Before this, one earning could be paid into the wallet two or three times.' },
  owedDebt: { date: '2026-10-13', what: 'Before this, taking back more than the wallet held stopped at zero instead of booking the rest as owed.' },
  clawbackHistory: { date: '2026-11-01', what: 'Before this, money taken back after payout for returns, dispute refunds and late penalties wrote no history entry.' },
} as const;

export interface ExplainEarning {
  id: string;
  order?: string | null;
  amount: number;
  net_amount: number;
  released: boolean;
  released_at?: Date | string | null;
  created_at?: Date | string | null;
  milestone?: string | null;
}

export interface ExplainTransaction {
  id: string;
  reference?: string | null;
  type: string;
  status: string;
  amount: number;
  channel?: string | null;
  created_at?: Date | string | null;
  earning_id?: string | null;
  payout_reversed?: boolean;
  clawback?: boolean;
  /** Logged without a wallet (old payouts): never part of the history sum. */
  unlinked?: boolean;
}

export interface MoneyCause {
  kind: string;
  /** What it means, in plain words. */
  meaning: string;
  /** Signed amount it moves the wallet away from its records (+ = wallet holds more). */
  accounts_for: number;
  count: number;
  /** Every record involved predates the fix for this cause. */
  before_fix: boolean;
  fix_date?: string;
  examples: Record<string, unknown>[];
}

export interface VendorMoneyExplanation {
  balance: number;
  history_balance: number;
  balance_difference: number;
  balance_unexplained: number;
  pending: number;
  unreleased_earnings: number;
  pending_difference: number;
  owed: number;
  causes: MoneyCause[];
  pending_note: string | null;
  last_activity: string | null;
  /** Nothing has happened since the last fix: the differences are old. */
  quiet_since_last_fix: boolean;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : null;
const before = (d: Date | string | null | undefined, fix: string) =>
  !!d && new Date(d).getTime() < new Date(`${fix}T00:00:00Z`).getTime();
const EXAMPLES = 10;

export function explainVendorMoney(input: {
  wallet: { balance: number; pending_balance: number; owed_balance: number };
  earnings: ExplainEarning[];
  transactions: ExplainTransaction[];
}): VendorMoneyExplanation {
  const { wallet, earnings, transactions } = input;
  const linked = transactions.filter((t) => !t.unlinked);

  const sums: LedgerSums = { fund: 0, credit: 0, debit: 0, refund: 0 };
  for (const t of linked) {
    const ok = t.status === 'success';
    if (t.type === 'fund' && ok) sums.fund += t.amount;
    else if (t.type === 'credit' && ok) sums.credit += t.amount;
    else if (t.type === 'debit' && (ok || t.status === 'pending')) sums.debit += t.amount;
    else if (t.type === 'refund' && ok) sums.refund += t.amount;
  }
  const history = historyBalance(sums);
  const balanceDiff = r2(wallet.balance - history);
  const unreleased = r2(
    earnings.filter((e) => !e.released).reduce((s, e) => s + (e.net_amount || 0), 0),
  );
  const pendingDiff = r2(wallet.pending_balance - unreleased);

  const creditsByEarning = new Map<string, ExplainTransaction[]>();
  const refundEarnings = new Set<string>();
  for (const t of linked) {
    if (!t.earning_id) continue;
    if (t.type === 'credit') {
      const list = creditsByEarning.get(t.earning_id) ?? [];
      list.push(t);
      creditsByEarning.set(t.earning_id, list);
    }
    if (t.type === 'refund') refundEarnings.add(t.earning_id);
  }

  const causes: MoneyCause[] = [];
  const add = (c: MoneyCause) => {
    if (c.count) causes.push({ ...c, accounts_for: r2(c.accounts_for) });
  };

  // Released into the wallet with no CREDIT entry: the wallet holds more.
  const noCredit = earnings.filter(
    (e) => e.released && e.net_amount > 0 && !creditsByEarning.has(e.id),
  );
  add({
    kind: 'released_without_history',
    meaning: 'Earnings paid into the wallet with no history entry, so the wallet holds more than its history shows.',
    accounts_for: noCredit.reduce((s, e) => s + e.net_amount, 0),
    count: noCredit.length,
    before_fix: noCredit.every((e) => before(e.released_at ?? e.created_at, MONEY_FIXES.ledger.date)),
    fix_date: MONEY_FIXES.ledger.date,
    examples: noCredit.slice(0, EXAMPLES).map((e) => ({ order: e.order, net: r2(e.net_amount), released: day(e.released_at) })),
  });

  // One earning credited more than once: the vendor was paid it again. The
  // wallet moved each time, so this is an overpayment, not a history gap.
  const dupes = [...creditsByEarning.entries()].filter(
    ([, list]) => list.filter((t) => t.status === 'success').length > 1,
  );
  const byId = new Map(earnings.map((e) => [e.id, e]));
  add({
    kind: 'paid_more_than_once',
    meaning: 'The same earning was paid into the wallet more than once. The extra is an overpayment (each copy is in the history, so it does not show as a difference).',
    accounts_for: 0,
    count: dupes.length,
    before_fix: dupes.every(([, list]) => list.every((t) => before(t.created_at, MONEY_FIXES.duplicatePayout.date))),
    fix_date: MONEY_FIXES.duplicatePayout.date,
    examples: dupes.slice(0, EXAMPLES).map(([id, list]) => ({
      order: byId.get(id)?.order ?? null,
      times: list.length,
      each: r2(list[0].amount),
      overpaid: r2(list.slice(1).reduce((s, t) => s + t.amount, 0)),
      dates: list.map((t) => day(t.created_at)),
    })),
  });

  // Old payouts: logged without the wallet, or taken twice on success.
  const payouts = transactions.filter((t) => t.channel === 'payout');
  const unlinkedPaid = payouts.filter((t) => t.unlinked && t.status === 'success');
  add({
    kind: 'payout_missing_from_history',
    meaning: 'Payouts logged without the wallet, so they left the wallet but are not in its history: the wallet holds less.',
    accounts_for: -unlinkedPaid.reduce((s, t) => s + t.amount, 0),
    count: unlinkedPaid.length,
    before_fix: unlinkedPaid.every((t) => before(t.created_at, MONEY_FIXES.ledger.date)),
    fix_date: MONEY_FIXES.ledger.date,
    examples: unlinkedPaid.slice(0, EXAMPLES).map((t) => ({ reference: t.reference, amount: r2(t.amount), date: day(t.created_at) })),
  });
  const doubleTaken = payouts.filter(
    (t) => !t.unlinked && t.status === 'success' && before(t.created_at, MONEY_FIXES.ledger.date),
  );
  add({
    kind: 'payout_taken_twice',
    meaning: 'Payouts completed before the July fix were taken from the wallet a second time when the bank confirmed them: the wallet holds less, by up to these amounts.',
    accounts_for: -doubleTaken.reduce((s, t) => s + t.amount, 0),
    count: doubleTaken.length,
    before_fix: true,
    fix_date: MONEY_FIXES.ledger.date,
    examples: doubleTaken.slice(0, EXAMPLES).map((t) => ({ reference: t.reference, amount: r2(t.amount), date: day(t.created_at) })),
  });
  const failedNotRestored = payouts.filter(
    (t) => !t.unlinked && (t.status === 'failed' || t.status === 'reversed') && t.payout_reversed !== true,
  );
  add({
    kind: 'failed_payout_check',
    meaning: 'Failed payouts with no sign the money went back. A payout that failed the moment it was sent is restored without that sign, so check these against the wallet before acting.',
    accounts_for: 0,
    count: failedNotRestored.length,
    before_fix: failedNotRestored.every((t) => before(t.created_at, MONEY_FIXES.ledger.date)),
    examples: failedNotRestored.slice(0, EXAMPLES).map((t) => ({ reference: t.reference, amount: r2(t.amount), status: t.status, date: day(t.created_at) })),
  });

  // Released then fully taken back, with no clawback entry. The amount taken
  // is gone from the row (net is 0), so the gross is the nearest clue.
  const silentClawbacks = earnings.filter(
    (e) => e.released && !(e.net_amount > 0) && e.milestone !== 'cancellation_fee' && creditsByEarning.has(e.id) && !refundEarnings.has(e.id),
  );
  add({
    kind: 'taken_back_without_history',
    meaning: 'Earnings paid out and later taken back with no history entry: the wallet holds less. The amount taken is not stored, so the gross is shown as a guide.',
    accounts_for: -silentClawbacks.reduce(
      (s, e) => s + (creditsByEarning.get(e.id)?.[0]?.amount ?? 0),
      0,
    ),
    count: silentClawbacks.length,
    before_fix: silentClawbacks.every((e) => before(e.released_at ?? e.created_at, MONEY_FIXES.clawbackHistory.date)),
    fix_date: MONEY_FIXES.clawbackHistory.date,
    examples: silentClawbacks.slice(0, EXAMPLES).map((e) => ({ order: e.order, paid: r2(creditsByEarning.get(e.id)?.[0]?.amount ?? 0), gross: r2(e.amount) })),
  });

  const explained = causes.reduce((s, c) => s + c.accounts_for, 0);
  const unexplainedBalance = r2(balanceDiff - explained);

  // The duplicate-payout bug could pay an earning in more often than it was
  // recorded. A leftover that is a whole number of copies points there.
  for (const ex of causes.find((c) => c.kind === 'paid_more_than_once')?.examples ?? []) {
    const each = Number(ex.each) || 0;
    const copies = each > 0 ? unexplainedBalance / each : 0;
    if (copies >= 1 && Math.abs(copies - Math.round(copies)) < 0.001) {
      ex.unexplained_matches = `The unexplained ₦${unexplainedBalance.toLocaleString()} is ${Math.round(copies)} more cop${Math.round(copies) === 1 ? 'y' : 'ies'} of this earning: likely paid in again without a history entry.`;
    }
  }

  let pendingNote: string | null = null;
  if (Math.abs(pendingDiff) >= 1) {
    pendingNote =
      wallet.pending_balance < 0
        ? 'Pending is below zero: payouts took out money that was never added to pending (earnings recorded by an older path, or paid more than once). Pending should equal the unreleased earnings.'
        : pendingDiff > 0
          ? 'Pending holds more than the unreleased earnings: earnings were removed (cancelled, rejected or refunded) without lowering pending. Pending should equal the unreleased earnings.'
          : 'Pending holds less than the unreleased earnings: pending was lowered (or stopped at zero) without the earnings changing. Pending should equal the unreleased earnings.';
  }

  const dates = [
    ...transactions.map((t) => t.created_at),
    ...earnings.map((e) => e.released_at ?? e.created_at),
  ]
    .filter(Boolean)
    .map((d) => new Date(d as any).getTime());
  const last = dates.length ? new Date(Math.max(...dates)) : null;

  return {
    balance: r2(wallet.balance),
    history_balance: history,
    balance_difference: balanceDiff,
    balance_unexplained: unexplainedBalance,
    pending: r2(wallet.pending_balance),
    unreleased_earnings: unreleased,
    pending_difference: pendingDiff,
    owed: r2(wallet.owed_balance),
    causes,
    pending_note: pendingNote,
    last_activity: day(last),
    quiet_since_last_fix: !last || before(last, MONEY_FIXES.clawbackHistory.date),
  };
}
