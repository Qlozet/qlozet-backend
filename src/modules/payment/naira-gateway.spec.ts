import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { NairaGatewayService } from './naira-gateway.service';
import { FlutterwaveService } from './flutterwave.service';
import { TransactionStatus } from '../transactions/schema/transaction.schema';

function build(opts: {
  settings?: any;
  flwConfigured?: boolean;
  tx?: any;
  paystackInit?: jest.Mock;
  flwInit?: jest.Mock;
  flwVerify?: jest.Mock;
  sendPayout?: jest.Mock;
  flwTransfer?: jest.Mock;
} = {}) {
  const tx = {
    reference: 'QLZ-1',
    amount: 10_000,
    currency: 'NGN',
    status: TransactionStatus.PENDING,
    metadata: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...(opts.tx ?? {}),
  };
  const paystack: any = {
    initializePaystackPayment:
      opts.paystackInit ??
      jest.fn().mockResolvedValue({ success: true, data: { paymentUrl: 'https://paystack/x' } }),
    verifyPaystackPayment: jest.fn().mockResolvedValue({ status: 'success' }),
    sendPayout: opts.sendPayout ?? jest.fn().mockResolvedValue('QLZ-P'),
  };
  const flutterwave: any = {
    isConfigured: () => opts.flwConfigured ?? true,
    initialize: opts.flwInit ?? jest.fn().mockResolvedValue({ link: 'https://flw/x' }),
    verify: opts.flwVerify ?? jest.fn(),
    bankCodeFor: jest.fn().mockResolvedValue('058'),
    transfer: opts.flwTransfer ?? jest.fn().mockResolvedValue({ id: 9, status: 'NEW' }),
  };
  const transactions: any = {
    findByReference: jest.fn().mockResolvedValue(tx),
    attachMetadata: jest.fn().mockResolvedValue(undefined),
    settleOnce: jest.fn().mockResolvedValue({ ...tx, status: TransactionStatus.SUCCESS }),
    markFailed: jest.fn(),
    create: jest.fn().mockResolvedValue({ reference: 'QLZ-NEW' }),
  };
  const platform: any = {
    getSettings: jest.fn().mockResolvedValue({
      naira_processor: 'paystack',
      flutterwave_enabled: true,
      ...(opts.settings ?? {}),
    }),
  };
  const env: Record<string, string> = {
    FRONTEND_URL: 'https://shop',
    VENDOR_FRONTEND_URL: 'https://vendor',
  };
  const config: any = { get: (k: string) => env[k] };
  const businessModel: any = {
    findById: jest.fn().mockResolvedValue({
      business_name: 'Ada Wears',
      payout_account_number: '0123456789',
      payout_bank_code: '058',
      payout_bank_name: 'GTBank',
    }),
  };
  const connection: any = { models: {} };
  const gateway = new NairaGatewayService(
    paystack,
    flutterwave,
    transactions,
    platform,
    config,
    businessModel,
    connection,
  );
  return { gateway, paystack, flutterwave, transactions, tx };
}

describe('NairaGatewayService — starting a payment', () => {
  it('uses Paystack by default and stamps it on the transaction', async () => {
    const { gateway, flutterwave, transactions } = build();
    const res: any = await gateway.initialize('QLZ-1', 'a@b.co');
    expect(res.data.processor).toBe('paystack');
    expect(res.data.paymentUrl).toBe('https://paystack/x');
    expect(flutterwave.initialize).not.toHaveBeenCalled();
    expect(transactions.attachMetadata).toHaveBeenCalledWith('QLZ-1', {
      payment_method: 'paystack',
      processor: 'paystack',
    });
  });

  it('falls over to Flutterwave when Paystack cannot start the payment', async () => {
    const { gateway, flutterwave, transactions } = build({
      paystackInit: jest.fn().mockRejectedValue(new BadGatewayException('down')),
    });
    const res: any = await gateway.initialize('QLZ-1', 'a@b.co');
    expect(res.data.processor).toBe('flutterwave');
    expect(res.data.paymentUrl).toBe('https://flw/x');
    expect(flutterwave.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: 'QLZ-1',
        amount: 10_000,
        redirectUrl: 'https://shop/payment/verify?reference=QLZ-1',
      }),
    );
    expect(transactions.attachMetadata).toHaveBeenCalledWith('QLZ-1', {
      payment_method: 'flutterwave',
      processor: 'flutterwave',
    });
  });

  it('sends vendors back to their wallet page on either provider', async () => {
    const down = jest.fn().mockRejectedValue(new BadGatewayException('down'));
    const { gateway, flutterwave } = build({ paystackInit: down });
    await gateway.initialize('QLZ-1', 'a@b.co', { returnTo: 'vendor' });
    expect(down).toHaveBeenCalledWith('QLZ-1', 'a@b.co', 'https://vendor/wallet?reference=QLZ-1');
    expect(flutterwave.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: 'https://vendor/wallet?reference=QLZ-1' }),
    );
  });

  it('skips a provider that just failed on the next payment', async () => {
    const paystackInit = jest.fn().mockRejectedValue(new BadGatewayException('down'));
    const { gateway } = build({ paystackInit });
    await gateway.initialize('QLZ-1', 'a@b.co');
    await gateway.initialize('QLZ-1', 'a@b.co');
    expect(paystackInit).toHaveBeenCalledTimes(1);
  });

  it('honours Flutterwave as the default', async () => {
    const { gateway, paystack } = build({ settings: { naira_processor: 'flutterwave' } });
    const res: any = await gateway.initialize('QLZ-1', 'a@b.co');
    expect(res.data.processor).toBe('flutterwave');
    expect(paystack.initializePaystackPayment).not.toHaveBeenCalled();
  });

  it('never uses Flutterwave while it is switched off or has no key', async () => {
    const down = jest.fn().mockRejectedValue(new BadGatewayException('down'));
    for (const variant of [
      build({ paystackInit: down, settings: { flutterwave_enabled: false } }),
      build({ paystackInit: down, flwConfigured: false }),
    ]) {
      await expect(variant.gateway.initialize('QLZ-1', 'a@b.co')).rejects.toThrow('down');
      expect(variant.flutterwave.initialize).not.toHaveBeenCalled();
    }
  });

  it('does not hop when the transaction itself is missing', async () => {
    const { gateway, flutterwave } = build({
      paystackInit: jest.fn().mockRejectedValue(new NotFoundException('Transaction not found')),
    });
    await expect(gateway.initialize('QLZ-1', 'a@b.co')).rejects.toBeInstanceOf(NotFoundException);
    expect(flutterwave.initialize).not.toHaveBeenCalled();
  });
});

describe('NairaGatewayService — confirming a payment', () => {
  it('checks Paystack payments with Paystack', async () => {
    const { gateway, paystack, flutterwave } = build();
    await gateway.verify('QLZ-1');
    expect(paystack.verifyPaystackPayment).toHaveBeenCalledWith('QLZ-1');
    expect(flutterwave.verify).not.toHaveBeenCalled();
  });

  it('settles a Flutterwave payment that covers the amount', async () => {
    const { gateway, transactions } = build({
      tx: { metadata: { payment_method: 'flutterwave' } },
      flwVerify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: 10_000,
        currency: 'NGN',
        id: 77,
        raw: {},
      }),
    });
    const res: any = await gateway.verify('QLZ-1');
    expect(res.status).toBe(TransactionStatus.SUCCESS);
    expect(transactions.settleOnce).toHaveBeenCalledWith(
      'QLZ-1',
      expect.objectContaining({
        'metadata.flutterwave_charge': expect.objectContaining({ id: 77 }),
      }),
    );
  });

  it('refuses to settle when less was paid than asked', async () => {
    const { gateway, transactions } = build({
      tx: { metadata: { payment_method: 'flutterwave' } },
      flwVerify: jest.fn().mockResolvedValue({
        status: 'successful',
        amount: 100,
        currency: 'NGN',
        id: 77,
      }),
    });
    const res: any = await gateway.verify('QLZ-1');
    expect(res.status).toBe(TransactionStatus.PENDING);
    expect(transactions.settleOnce).not.toHaveBeenCalled();
  });

  it('leaves an unpaid Flutterwave payment pending, not failed', async () => {
    const { gateway, transactions } = build({
      tx: { metadata: { payment_method: 'flutterwave' } },
      flwVerify: jest.fn().mockResolvedValue({ status: 'not_found' }),
    });
    const res: any = await gateway.verify('QLZ-1');
    expect(res.status).toBe(TransactionStatus.PENDING);
    expect(transactions.markFailed).not.toHaveBeenCalled();
  });
});

describe('NairaGatewayService — payouts', () => {
  it('pays through Paystack when it works', async () => {
    const { gateway, flutterwave } = build({ settings: { flutterwave_payouts_enabled: true } });
    await gateway.payout('biz', 5_000, 'Withdrawal', 'QLZ-P');
    expect(flutterwave.transfer).not.toHaveBeenCalled();
  });

  it('sends via Flutterwave when Paystack refuses and the switch is on', async () => {
    const refused: any = new Error('Request failed');
    refused.response = { status: 400, data: { message: 'Your balance is not enough' } };
    const { gateway, flutterwave } = build({
      settings: { flutterwave_payouts_enabled: true },
      sendPayout: jest.fn().mockRejectedValue(refused),
    });
    await gateway.payout('biz', 5_000, 'Withdrawal', 'QLZ-P');
    expect(flutterwave.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'QLZ-P', amount: 5_000, accountNumber: '0123456789' }),
    );
  });

  it('never hops while Flutterwave payouts are off', async () => {
    const { gateway, flutterwave } = build({
      sendPayout: jest.fn().mockRejectedValue(new BadRequestException('no recipient')),
    });
    await expect(gateway.payout('biz', 5_000, 'W', 'QLZ-P')).rejects.toThrow('no recipient');
    expect(flutterwave.transfer).not.toHaveBeenCalled();
  });

  it('never hops on a timeout or an OTP hold (Paystack may still pay)', async () => {
    const timeout: any = new Error('timeout of 15000ms exceeded');
    for (const err of [timeout, new BadRequestException('Payouts require an OTP on this Paystack account')]) {
      const { gateway, flutterwave } = build({
        settings: { flutterwave_payouts_enabled: true },
        sendPayout: jest.fn().mockRejectedValue(err),
      });
      await expect(gateway.payout('biz', 5_000, 'W', 'QLZ-P')).rejects.toBe(err);
      expect(flutterwave.transfer).not.toHaveBeenCalled();
    }
  });
});

describe('FlutterwaveService — webhook check', () => {
  const svc = new FlutterwaveService({} as any, { get: () => 'shh' } as any);
  it('accepts the echoed secret hash', () => {
    expect(svc.isValidWebhook({ 'verif-hash': 'shh' }, '{}')).toBe(true);
    expect(svc.isValidWebhook({ 'verif-hash': 'nope' }, '{}')).toBe(false);
    expect(svc.isValidWebhook({}, '{}')).toBe(false);
  });
  it('accepts a correct body signature and rejects a tampered body', () => {
    const body = '{"event":"charge.completed"}';
    const sig = crypto.createHmac('sha256', 'shh').update(body).digest('base64');
    expect(svc.isValidWebhook({ 'flutterwave-signature': sig }, body)).toBe(true);
    expect(svc.isValidWebhook({ 'flutterwave-signature': sig }, body + ' ')).toBe(false);
  });
});
