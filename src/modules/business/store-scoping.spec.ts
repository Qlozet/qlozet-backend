import { Types } from 'mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderService } from '../orders/orders.service';
import { OrderController } from '../orders/orders.controller';
import { DiscountService } from '../products/discount.service';
import { DisputesService } from '../disputes/disputes.service';
import { ReturnsService } from '../returns/returns.service';
import { BespokeService } from '../bespoke/bespoke.service';

/**
 * A store may only act on its own orders and products, and only sees a
 * customer's short name. Each block pins a hole found in the pilot QA review
 * (Known bugs BUG-01 to BUG-04 in the staging checklist).
 */

const storeA = new Types.ObjectId().toString();
const storeB = new Types.ObjectId().toString();

/** A Mongoose-style query chain whose end resolves to `rows`. */
const chain = (rows: any) => {
  const q: any = {};
  for (const step of ['sort', 'skip', 'limit', 'populate', 'select']) {
    q[step] = () => q;
  }
  q.lean = async () => rows;
  return q;
};

describe('BUG-01: a store cancels only its own orders', () => {
  const orderWith = (...owners: string[]) => ({
    reference: 'ORD-1',
    status: 'processing',
    customer: new Types.ObjectId(),
    items: owners.map((business) => ({ business: new Types.ObjectId(business) })),
    save: jest.fn(),
  });

  const serviceFor = (order: any) => {
    const service: any = Object.create(OrderService.prototype);
    service.orderModel = { findOne: async () => order };
    return service;
  };

  it("refuses another store's order and changes nothing", async () => {
    const order = orderWith(storeB);
    await expect(
      serviceFor(order).cancelOrder('ORD-1', { businessId: storeA }),
    ).rejects.toThrow(ForbiddenException);
    expect(order.save).not.toHaveBeenCalled();
    expect(order.status).toBe('processing');
  });

  it("refuses an order that also holds another store's items", async () => {
    const order = orderWith(storeA, storeB);
    await expect(
      serviceFor(order).cancelOrder('ORD-1', { businessId: storeA }),
    ).rejects.toThrow(BadRequestException);
    expect(order.save).not.toHaveBeenCalled();
  });

  it('refuses when the caller has no store', async () => {
    const order = orderWith(storeA);
    await expect(
      serviceFor(order).cancelOrder('ORD-1', { businessId: undefined }),
    ).rejects.toThrow(ForbiddenException);
    expect(order.save).not.toHaveBeenCalled();
  });

  it("lets a store cancel an order that is all its own, ignoring another store's rejected item", () => {
    const service: any = Object.create(OrderService.prototype);
    const order = {
      items: [
        { business: new Types.ObjectId(storeA) },
        { business: new Types.ObjectId(storeB), rejected: true },
      ],
    };
    expect(() => service.assertStoreMayCancel(order, storeA)).not.toThrow();
  });

  it("the vendor route passes the caller's store", async () => {
    const cancelOrder = jest.fn().mockResolvedValue({ ok: true });
    const controller: any = Object.create(OrderController.prototype);
    controller.orderService = { cancelOrder };
    await controller.cancelOrder('ORD-1', { business: { id: storeA } });
    expect(cancelOrder).toHaveBeenCalledWith('ORD-1', { businessId: storeA });
  });
});

describe("BUG-02: a store's discount touches only its own products", () => {
  const discountId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  const serviceWith = (productIsTheirs: boolean) => {
    const service: any = Object.create(DiscountService.prototype);
    service.logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
    const updateOne = jest.fn().mockResolvedValue({});
    service.discountModel = {
      findOne: async () => ({ _id: discountId, business: storeA }),
      findById: () => ({
        exec: async () => ({ _id: discountId, business: new Types.ObjectId(storeB) }),
      }),
      updateOne,
    };
    service.productModel = {
      exists: async () => (productIsTheirs ? { _id: productId } : null),
      findById: async () => null,
      updateOne: jest.fn(),
    };
    return { service, updateOne };
  };

  it("refuses to include another store's product", async () => {
    const { service, updateOne } = serviceWith(false);
    await expect(
      service.includeProduct(discountId, productId, storeA),
    ).rejects.toThrow(NotFoundException);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("refuses to exclude another store's product", async () => {
    const { service, updateOne } = serviceWith(false);
    await expect(
      service.excludeProduct(discountId, productId, storeA),
    ).rejects.toThrow(NotFoundException);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('includes its own product', async () => {
    const { service, updateOne } = serviceWith(true);
    await service.includeProduct(discountId, productId, storeA);
    expect(updateOne).toHaveBeenCalled();
  });

  it("refuses to run another store's discount from the vendor route", async () => {
    const { service } = serviceWith(true);
    await expect(
      service.applyDiscountToMatchingProducts(discountId, storeA),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("BUG-03: vendors never receive a customer's email", () => {
  const customer = {
    _id: new Types.ObjectId(),
    full_name: 'Ada Obi',
    email: 'ada@example.com',
    phone_number: '+2348000000000',
  };

  const expectShortName = (row: any) => {
    expect(row.customer.full_name).toBe('Ada O.');
    expect(row.customer.email).toBeUndefined();
    expect(row.customer.phone_number).toBeUndefined();
  };

  it('dispute list', async () => {
    const service: any = Object.create(DisputesService.prototype);
    service.disputeModel = { find: () => chain([{ _id: 1, customer: { ...customer } }]) };
    const rows = await service.getVendorDisputes(storeA);
    expectShortName(rows[0]);
  });

  it('return list', async () => {
    const service: any = Object.create(ReturnsService.prototype);
    service.returnModel = { find: () => chain([{ _id: 1, customer: { ...customer } }]) };
    const rows = await service.getVendorReturns(storeA);
    expectShortName(rows[0]);
  });

  it('bespoke quote requests', async () => {
    const service: any = Object.create(BespokeService.prototype);
    service.quoteModel = {
      find: () => chain([{ _id: 1, customer: { ...customer } }]),
      countDocuments: async () => 1,
    };
    const page: any = await service.getQuoteRequests(storeA, 1, 10);
    const rows = page.data ?? page.rows ?? page.items ?? page.docs;
    expectShortName(rows[0]);
  });
});

describe('BUG-04: bespoke work goes only to approved stores', () => {
  it('refuses quote requests to a store still in review', () => {
    const service: any = Object.create(BespokeService.prototype);
    expect(() =>
      service.assertVendorsMaySell([
        { business_name: 'Approved Ltd', status: 'approved' },
        { business_name: 'New Tailor', status: 'pending' },
      ]),
    ).toThrow('New Tailor has not completed verification yet');
    expect(() =>
      service.assertVendorsMaySell([{ business_name: 'Paused', status: 'verified', is_active: false }]),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertVendorsMaySell([
        { business_name: 'A', status: 'approved' },
        { business_name: 'B', status: 'verified' },
      ]),
    ).not.toThrow();
  });

  it("refuses to accept a quote from a store that isn't approved, before any charge", async () => {
    const service: any = Object.create(BespokeService.prototype);
    const designLookup = jest.fn();
    service.quoteModel = {
      findOne: async () => ({
        _id: new Types.ObjectId(),
        status: 'submitted',
        vendor: new Types.ObjectId(storeB),
        expires_at: new Date(Date.now() + 86_400_000),
      }),
    };
    service.businessModel = {
      findById: () => chain({ business_name: 'New Tailor', status: 'pending' }),
    };
    service.designModel = { findById: designLookup };
    await expect(
      service.acceptQuote(new Types.ObjectId().toString(), { id: new Types.ObjectId().toString() }, 'wallet'),
    ).rejects.toThrow('New Tailor has not completed verification yet');
    expect(designLookup).not.toHaveBeenCalled();
  });
});
