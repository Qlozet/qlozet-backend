import { Types } from 'mongoose';
import { WebhookService } from './webhook.service';
import { OrderSchema } from '../orders/schemas/orders.schema';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Token flow — the order-payment reward must be granted exactly once per
 * order (webhook retries and the verify safety-net both re-run finalisation),
 * and only when the admin-tunable reward is on.
 */
describe('order-payment token reward', () => {
  const mongo = new MemoryMongo();
  let orderModel: any;
  let grant: jest.Mock;
  let rewardSetting: number;
  let service: any;

  beforeAll(async () => {
    await mongo.start();
    orderModel = mongo.model('Order', OrderSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    grant = jest.fn().mockResolvedValue(undefined);
    rewardSetting = 25;

    service = Object.create(WebhookService.prototype);
    Object.assign(service, {
      logger: stubLogger,
      orderModel,
      businessService: {
        recordBusinessEarnings: jest.fn().mockResolvedValue(undefined),
      },
      productService: { updateInventory: jest.fn().mockResolvedValue({}) },
      eventModel: { insertMany: jest.fn().mockResolvedValue([]) },
      fabricClaimModel: { updateOne: jest.fn() },
      platformSettingsModel: {
        findOne: () => ({
          lean: async () => ({ order_payment_token_reward: rewardSetting }),
        }),
      },
      tokenService: { grant },
    });
  });

  const makeOrder = () =>
    orderModel.create({
      customer: new Types.ObjectId(),
      items: [],
      total: 30_000,
      subtotal: 30_000,
      status: 'pending',
      payment_status: 'unpaid',
      reference: `QLZ-${Math.random().toString(36).slice(2, 8)}`,
    });

  const txn = (order: any) => ({ channel: 'checkout', order: { _id: order._id } });

  // grantOrderPaymentReward is fire-and-forget inside finalisation.
  const flush = () => new Promise((r) => setImmediate(r));

  it('grants the configured reward once on first finalisation', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(txn(order));
    await flush();

    expect(grant).toHaveBeenCalledTimes(1);
    const [recipient, amount, feature] = grant.mock.calls[0];
    expect(recipient).toEqual({ customer: order.customer.toString() });
    expect(amount).toBe(25);
    expect(feature).toBe('reward:order_payment');
  });

  it('never double-grants on webhook retry / verify refresh', async () => {
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(txn(order));
    await flush();
    await service.finalizeCheckoutOrder(txn(order));
    await service.finalizeCheckoutOrder(txn(order));
    await flush();

    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('reward of 0 means the feature is off', async () => {
    rewardSetting = 0;
    const order = await makeOrder();
    await service.finalizeCheckoutOrder(txn(order));
    await flush();

    expect(grant).not.toHaveBeenCalled();
  });

  it('a token-service failure never blocks order finalisation', async () => {
    grant.mockRejectedValue(new Error('token ledger down'));
    const order = await makeOrder();

    await expect(service.finalizeCheckoutOrder(txn(order))).resolves.toBeUndefined();
    await flush();

    const saved = await orderModel.findById(order._id).lean();
    expect(saved.payment_status).toBe('paid');
  });
});
