import { NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';

/**
 * getAdminVendorWallet() backs the admin console's vendor wallet panel. It
 * must read without writing (no wallet created, no debt settled), report what
 * the vendor can actually withdraw, and say when the running pending total
 * and the earnings rows disagree.
 */

const BID = '6a5a240d97e2e4726605225b';

const lean = (v: unknown) => {
  const q: any = {
    select: () => q,
    sort: () => q,
    limit: () => q,
    lean: () => Promise.resolve(v),
  };
  return q;
};

type Group = { released: boolean; scheduled: boolean; net: number; gross: number; commission: number };

const build = (opts: {
  business?: any;
  wallet?: any;
  groups?: Group[];
  firstDue?: Date | null;
  dueAmount?: number;
  hold?: number;
  payouts?: any;
}) => {
  const service = Object.create(WalletsService.prototype) as any;
  const groups = (opts.groups ?? []).map((g) => ({
    _id: { released: g.released, scheduled: g.scheduled },
    net: g.net,
    gross: g.gross,
    commission: g.commission,
    rows: 1,
  }));
  const businessEarningsModel = {
    aggregate: jest
      .fn()
      .mockResolvedValueOnce(groups)
      .mockResolvedValueOnce([{ amount: opts.dueAmount ?? 0 }]),
    find: jest.fn(() =>
      lean(opts.firstDue ? [{ release_date: opts.firstDue }] : []),
    ),
  };
  const walletModel = {
    findOne: jest.fn(() => lean(opts.wallet ?? null)),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  Object.assign(service, {
    businessModel: {
      findById: jest.fn(() =>
        lean(opts.business === undefined ? { business_name: 'BantuBlue' } : opts.business),
      ),
    },
    walletModel,
    businessEarningsModel,
    platformSettingsModel: { findOne: jest.fn(() => lean({ minimum_payout: 5000 })) },
    transactionService: {
      payoutSummary: jest.fn().mockResolvedValue(
        opts.payouts ?? { by_status: {}, last: null },
      ),
    },
  });
  return { service: service as WalletsService, walletModel };
};

describe('WalletsService.getAdminVendorWallet', () => {
  it('404s on a malformed id or an unknown vendor', async () => {
    const { service } = build({});
    await expect(service.getAdminVendorWallet('nope')).rejects.toBeInstanceOf(NotFoundException);
    const missing = build({ business: null });
    await expect(missing.service.getAdminVendorWallet(BID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reads a vendor with no wallet as zeros, without creating one', async () => {
    const { service, walletModel } = build({});
    const out = await service.getAdminVendorWallet(BID);
    expect(out.has_wallet).toBe(false);
    expect(out.balance).toBe(0);
    expect(out.available_to_withdraw).toBe(0);
    expect(out.next_release).toBeNull();
    expect(walletModel.create).not.toHaveBeenCalled();
    expect(walletModel.updateOne).not.toHaveBeenCalled();
  });

  it('holds nothing back for open returns (no conditional holds)', async () => {
    const { service } = build({
      wallet: { balance: 50_000, pending_balance: 0, owed_balance: 0 },
    });
    const out = await service.getAdminVendorWallet(BID);
    expect(out.withdrawal_hold).toBe(0);
    expect(out.available_to_withdraw).toBe(50_000);
  });

  it('a debt blocks withdrawals entirely', async () => {
    const { service } = build({
      wallet: { balance: 50_000, pending_balance: 0, owed_balance: 4_000 },
    });
    const out = await service.getAdminVendorWallet(BID);
    expect(out.owed_balance).toBe(4_000);
    expect(out.available_to_withdraw).toBe(0);
  });

  it('splits earnings into released, scheduled and awaiting delivery, and flags drift', async () => {
    const due = new Date('2026-10-20T00:00:00.000Z');
    const { service } = build({
      wallet: { balance: 18_000, pending_balance: 30_000, owed_balance: 0 },
      groups: [
        { released: true, scheduled: true, net: 18_000, gross: 20_000, commission: 2_000 },
        { released: false, scheduled: true, net: 9_000, gross: 10_000, commission: 1_000 },
        { released: false, scheduled: false, net: 18_000, gross: 20_000, commission: 2_000 },
      ],
      firstDue: due,
      dueAmount: 9_000,
    });
    const out = await service.getAdminVendorWallet(BID);
    expect(out.lifetime).toEqual({ gross: 50_000, commission: 5_000, net: 45_000, released: 18_000 });
    expect(out.unreleased_earnings).toBe(27_000);
    expect(out.awaiting_delivery).toBe(18_000);
    expect(out.next_release).toEqual({ date: due, amount: 9_000 });
    // 30,000 pending on the wallet against 27,000 of unreleased rows.
    expect(out.pending_drift).toBe(3_000);
  });

  it('totals payouts by status and masks the account number', async () => {
    const { service } = build({
      business: {
        business_name: 'BantuBlue',
        transfer_recipient_code: 'RCP_x',
        payout_bank_name: 'GTBank',
        payout_account_name: 'BANTU BLUE LTD',
        payout_account_number: '0123456789',
      },
      wallet: { balance: 0, pending_balance: 0, owed_balance: 0 },
      payouts: {
        by_status: {
          success: { amount: 120_000, count: 3 },
          pending: { amount: 15_000, count: 1 },
          failed: { amount: 5_000, count: 1 },
        },
        last: { amount: 15_000, status: 'pending', reference: 'ref', created_at: new Date() },
      },
    });
    const out = await service.getAdminVendorWallet(BID);
    expect(out.payouts.total_withdrawn).toBe(120_000);
    expect(out.payouts.in_flight).toBe(15_000);
    expect(out.payouts.failed_count).toBe(1);
    expect(out.payouts.count).toBe(5);
    expect(out.payout_account).toEqual({
      linked: true,
      rail: 'paystack',
      bank_name: 'GTBank',
      account_name: 'BANTU BLUE LTD',
      account_number: '******6789',
    });
  });
});
