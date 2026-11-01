import { explainVendorMoney, ExplainTransaction } from './vendor-money-explain';

const credit = (earning: string, amount: number, at: string): ExplainTransaction => ({
  id: `c-${earning}-${at}`,
  type: 'credit',
  status: 'success',
  amount,
  channel: 'earning',
  created_at: at,
  earning_id: earning,
});

describe('explainVendorMoney', () => {
  it('names an earning paid three times, with two history entries (the August bug)', () => {
    // Fashion Store's shape: one ₦33,939 earning paid in three times, two
    // credits recorded, pending never raised for it.
    const out = explainVendorMoney({
      wallet: { balance: 101_817, pending_balance: -101_817, owed_balance: 0 },
      earnings: [{ id: 'e1', order: 'QLZ-1', amount: 37_710, net_amount: 33_939, released: true, released_at: '2026-08-10', milestone: 'upfront' }],
      transactions: [credit('e1', 33_939, '2026-08-10'), credit('e1', 33_939, '2026-08-10')],
    });
    expect(out.balance_difference).toBe(33_939);
    const dup = out.causes.find((c) => c.kind === 'paid_more_than_once')!;
    expect(dup.count).toBe(1);
    expect(dup.before_fix).toBe(true);
    expect(dup.examples[0]).toMatchObject({ times: 2, overpaid: 33_939 });
    expect(dup.examples[0].unexplained_matches).toMatch(/1 more copy/);
    expect(out.pending_note).toMatch(/below zero/);
    expect(out.quiet_since_last_fix).toBe(true);
  });

  it('accounts for released earnings with no history entry', () => {
    const out = explainVendorMoney({
      wallet: { balance: 30_000, pending_balance: 0, owed_balance: 0 },
      earnings: [
        { id: 'e1', amount: 22_000, net_amount: 20_000, released: true, released_at: '2026-07-01' },
        { id: 'e2', amount: 11_000, net_amount: 10_000, released: true, released_at: '2026-08-01' },
      ],
      transactions: [credit('e2', 10_000, '2026-08-01')],
    });
    const c = out.causes.find((x) => x.kind === 'released_without_history')!;
    expect(c.accounts_for).toBe(20_000);
    expect(c.before_fix).toBe(true);
    expect(out.balance_unexplained).toBe(0);
  });

  it('accounts for old payouts logged without the wallet', () => {
    const out = explainVendorMoney({
      wallet: { balance: 50_000, pending_balance: 0, owed_balance: 0 },
      earnings: [{ id: 'e1', amount: 110_000, net_amount: 100_000, released: true, released_at: '2026-07-01' }],
      transactions: [
        credit('e1', 100_000, '2026-07-01'),
        { id: 'p1', reference: 'TRX-OLD', type: 'credit', status: 'success', amount: 50_000, channel: 'payout', created_at: '2026-07-20', unlinked: true },
      ],
    });
    expect(out.history_balance).toBe(100_000);
    const c = out.causes.find((x) => x.kind === 'payout_missing_from_history')!;
    expect(c.accounts_for).toBe(-50_000);
    expect(out.balance_unexplained).toBe(0);
  });

  it('accounts for money taken back after payout with no entry', () => {
    const out = explainVendorMoney({
      wallet: { balance: 0, pending_balance: 0, owed_balance: 0 },
      earnings: [{ id: 'e1', amount: 10_000, net_amount: 0, released: true, released_at: '2026-10-01' }],
      transactions: [credit('e1', 9_000, '2026-10-01')],
    });
    const c = out.causes.find((x) => x.kind === 'taken_back_without_history')!;
    expect(c.accounts_for).toBe(-9_000);
    expect(out.balance_unexplained).toBe(0);
  });

  it('accounts for part of a paid earning taken back with no entry, net of late-penalty entries', () => {
    const out = explainVendorMoney({
      wallet: { balance: 2_000, pending_balance: 0, owed_balance: 0 },
      earnings: [
        { id: 'e1', amount: 11_000, net_amount: 6_000, released: true, released_at: '2026-09-01' },
        { id: 'e2', amount: 5_500, net_amount: 3_000, released: true, released_at: '2026-11-02' },
      ],
      transactions: [
        credit('e1', 10_000, '2026-09-01'),
        credit('e2', 5_000, '2026-11-02'),
        // A logged late penalty on e2 (no earning id on these entries).
        { id: 'r1', type: 'refund', status: 'success', amount: 2_000, channel: 'refund', created_at: '2026-11-03', clawback: true },
        { id: 'w1', type: 'debit', status: 'success', amount: 7_000, channel: 'payout', created_at: '2026-11-04' },
      ],
    });
    expect(out.history_balance).toBe(6_000);
    const c = out.causes.find((x) => x.kind === 'taken_back_without_history')!;
    expect(c.accounts_for).toBe(-4_000);
    expect(out.balance_unexplained).toBe(0);
  });

  it('leaves a recent unexplained gap visible, and says activity continued after the fixes', () => {
    const out = explainVendorMoney({
      wallet: { balance: 12_000, pending_balance: 5_000, owed_balance: 0 },
      earnings: [{ id: 'e1', amount: 6_000, net_amount: 5_000, released: false, created_at: '2026-11-05' }],
      transactions: [{ id: 'f1', type: 'fund', status: 'success', amount: 10_000, created_at: '2026-11-03' }],
    });
    expect(out.balance_unexplained).toBe(2_000);
    expect(out.causes).toHaveLength(0);
    expect(out.pending_difference).toBe(0);
    expect(out.quiet_since_last_fix).toBe(false);
  });

  it('a clean wallet has nothing to explain', () => {
    const out = explainVendorMoney({
      wallet: { balance: 7_000, pending_balance: 0, owed_balance: 0 },
      earnings: [{ id: 'e1', amount: 11_000, net_amount: 10_000, released: true, released_at: '2026-11-02' }],
      transactions: [
        credit('e1', 10_000, '2026-11-02'),
        { id: 'w1', type: 'debit', status: 'success', amount: 3_000, channel: 'payout', created_at: '2026-11-03' },
      ],
    });
    expect(out.balance_difference).toBe(0);
    expect(out.causes).toHaveLength(0);
    expect(out.pending_note).toBeNull();
  });
});
