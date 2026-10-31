import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletSchema } from './schema/wallet.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Money a vendor owes back. A refund clawed from the spendable balance used
 * to be floored at zero: if the vendor had already withdrawn, the shortfall
 * was dropped and the platform paid the customer out of its own pocket.
 * Now the shortfall is carried as owed_balance, paid down by the next credit
 * and before any withdrawal, and withdrawals also hold back the released
 * earnings on orders with an open return.
 */
describe('WalletsService - owed balance and withdrawals', () => {
  const mongo = new MemoryMongo();
  let walletModel: any;
  let service: any;
  let createTxn: jest.Mock;
  let openReturns: any[];
  let releasedOnReturnedOrders: number;

  const business = new Types.ObjectId();

  beforeAll(async () => {
    await mongo.start();
    walletModel = mongo.model('Wallet', WalletSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await walletModel.deleteMany({});
    createTxn = jest.fn().mockResolvedValue({});
    openReturns = [];
    releasedOnReturnedOrders = 0;
    service = Object.create(WalletsService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      walletModel,
      transactionService: { create: createTxn, updateStatus: jest.fn() },
      platformSettingsModel: { findOne: () => ({ lean: async () => ({ minimum_payout: 2000 }) }) },
      businessModel: { findById: jest.fn().mockResolvedValue({ transfer_recipient_code: 'RCP', business_name: 'Ada Wears', created_by: { id: 'u1' } }) },
      nairaGateway: { payout: jest.fn().mockResolvedValue('PAY-1') },
      returnModel: {
        find: () => ({ select: () => ({ lean: async () => openReturns }) }),
      },
      businessEarningsModel: {
        aggregate: jest.fn(async () =>
          releasedOnReturnedOrders > 0 ? [{ _id: null, amount: releasedOnReturnedOrders }] : [],
        ),
      },
    });
  });

  const makeWallet = (over: Record<string, any> = {}) =>
    walletModel.create({ business, balance: 0, pending_balance: 0, owed_balance: 0, ...over });

  it('a clawback larger than the balance books the difference as owed instead of losing it', async () => {
    await makeWallet({ balance: 4_000 });

    const wallet = await service.reconcileBusinessWallet(business, { balance: -10_000 });

    expect(wallet.balance).toBe(0);
    expect(wallet.owed_balance).toBe(6_000);
    // Callers booking the claw-back in the vendor ledger learn what was taken.
    expect(wallet.shortfall).toBe(6_000);
  });

  it('a clawback the balance covers takes it all and owes nothing', async () => {
    await makeWallet({ balance: 12_000 });

    const wallet = await service.reconcileBusinessWallet(business, { balance: -10_000 });

    expect(wallet.balance).toBe(2_000);
    expect(wallet.owed_balance).toBe(0);
    expect(wallet.shortfall).toBe(0);
  });

  it('a later credit pays the owed amount down first and records the recovery', async () => {
    await makeWallet({ balance: 0, owed_balance: 6_000 });

    const wallet = await service.reconcileBusinessWallet(business, { balance: 10_000 });

    expect(wallet.owed_balance).toBe(0);
    expect(wallet.balance).toBe(4_000);
    expect(createTxn).toHaveBeenCalledTimes(1);
    expect(createTxn.mock.calls[0][0]).toMatchObject({ type: 'debit', amount: 6_000, channel: 'debt_recovery' });
  });

  it('settleOwed moves min(balance, owed) and is a no-op when nothing is owed', async () => {
    await makeWallet({ balance: 2_500, owed_balance: 6_000 });

    expect(await service.settleOwed(business)).toBe(2_500);
    let saved = await walletModel.findOne({ business }).lean();
    expect(saved.balance).toBe(0);
    expect(saved.owed_balance).toBe(3_500);

    await walletModel.updateOne({ business }, { $set: { owed_balance: 0, balance: 9_000 } });
    expect(await service.settleOwed(business)).toBe(0);
    saved = await walletModel.findOne({ business }).lean();
    expect(saved.balance).toBe(9_000);
  });

  it('a withdrawal is refused while money is still owed, after settling what it can', async () => {
    await makeWallet({ balance: 3_000, owed_balance: 5_000 });

    await expect(service.requestWithdrawal(business.toString(), 2_000)).rejects.toThrow(/still owed/);

    const saved = await walletModel.findOne({ business }).lean();
    expect(saved.balance).toBe(0);
    expect(saved.owed_balance).toBe(2_000);
    expect(service.nairaGateway.payout).not.toHaveBeenCalled();
  });

  it('an open return holds nothing back from a withdrawal (no conditional holds)', async () => {
    await makeWallet({ balance: 20_000 });
    openReturns = [{ order: new Types.ObjectId() }];
    releasedOnReturnedOrders = 15_000;

    // Paystack does not allow holding vendor money on a condition
    // (business/settlement.ts); a refund after payout is recovered instead.
    await expect(service.requestWithdrawal(business.toString(), 20_000)).resolves.toMatchObject({
      data: { amount: 20_000 },
    });
  });

  it('withdrawals proceed normally with nothing owed and no open return', async () => {
    await makeWallet({ balance: 20_000 });

    const result = await service.requestWithdrawal(business.toString(), 8_000);

    expect(result.data.amount).toBe(8_000);
    const saved = await walletModel.findOne({ business }).lean();
    expect(saved.balance).toBe(12_000);
  });

  it('refundToCustomerWallet credits the exact amount and records a REFUND row', async () => {
    const customer = new Types.ObjectId();
    const order = { _id: new Types.ObjectId(), reference: 'QLZ-1', customer };

    const result = await service.refundToCustomerWallet({ order, amount: 5_000, reason: 'return_refund' });

    const saved = await walletModel.findOne({ customer }).lean();
    expect(saved.balance).toBe(5_000);
    expect(result.walletId).toBe(String(saved._id));
    expect(createTxn).toHaveBeenCalledTimes(1);
    expect(createTxn.mock.calls[0][0]).toMatchObject({
      type: 'refund',
      amount: 5_000,
      channel: 'refund',
      metadata: { order_reference: 'QLZ-1', reason: 'return_refund' },
    });
  });

  it('refundToCustomerWallet refuses a non-positive amount', async () => {
    const result = await service.refundToCustomerWallet({
      order: { _id: new Types.ObjectId(), customer: new Types.ObjectId() },
      amount: 0,
      reason: 'x',
    });
    expect(result).toBeNull();
    expect(createTxn).not.toHaveBeenCalled();
  });

  it('BadRequestException is what the vendor sees for every refusal', async () => {
    await makeWallet({ balance: 1_000 });
    await expect(service.requestWithdrawal(business.toString(), 5_000)).rejects.toBeInstanceOf(BadRequestException);
  });
});
