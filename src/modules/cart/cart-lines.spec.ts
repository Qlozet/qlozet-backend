import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CartService } from './cart.service';

/**
 * Cart lines: two sizes of one product are two lines, a line is changed or
 * removed by its own id, and a guest cart merges into the account once
 * without doubling anything.
 */

const P1 = new Types.ObjectId().toString();
const P2 = new Types.ObjectId().toString();

const build = (initial: any[] = []) => {
  const cart: any = {
    items: initial.map((i) => ({ _id: new Types.ObjectId(), ...i })),
    subtotal: 0,
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
  };
  // Mongoose gives pushed subdocuments an _id; mimic that.
  const push = cart.items.push.bind(cart.items);
  cart.items.push = (...rows: any[]) =>
    push(...rows.map((r) => ({ _id: new Types.ObjectId(), ...r })));

  const service: any = Object.create(CartService.prototype);
  Object.assign(service, {
    cartModel: {
      findOne: jest.fn(() => ({ populate: () => Promise.resolve(cart) })),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    },
    productModel: {
      findById: jest.fn((id: string) =>
        Promise.resolve(
          id === 'gone'
            ? null
            : id === 'pending'
              ? { _id: id, base_price: 10000, kind: 'clothing', status: 'active', moderation: { status: 'pending' } }
              : { _id: id, base_price: 10000, discounted_price: null, kind: 'clothing', status: 'active' },
        ),
      ),
    },
    businessModel: { findById: jest.fn() },
    priceCalculationService: {
      calculateItemTotal: jest.fn().mockResolvedValue(10000),
    },
  });
  return { service: service as CartService, cart };
};

const add = (service: CartService, productId: string, line: Record<string, string>) =>
  service.addItem('u1', productId, 1, undefined, undefined, undefined, undefined, undefined, line);

describe('cart lines', () => {
  it('two sizes of one product are two lines; the same size again is more of one', async () => {
    const { service, cart } = build();
    await add(service, P1, { lineKey: `${P1}|M`, size: 'M' });
    await add(service, P1, { lineKey: `${P1}|L`, size: 'L' });
    await add(service, P1, { lineKey: `${P1}|M`, size: 'M' });
    expect(cart.items).toHaveLength(2);
    const m = cart.items.find((i: any) => i.size === 'M');
    expect(m.quantity).toBe(2);
    expect(m.total_price).toBe(20000);
    expect(cart.subtotal).toBe(30000);
  });

  it('an add with no key behaves as it always did: one line per product', async () => {
    const { service, cart } = build();
    await service.addItem('u1', P1, 1);
    await service.addItem('u1', P1, 2);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  it('refuses a listing that is still awaiting review', async () => {
    const { service } = build();
    await expect(service.addItem('u1', 'pending', 1)).rejects.toThrow('not available');
  });

  it('removing one line leaves the other size alone', async () => {
    const { service, cart } = build([
      { product_id: P1, line_key: `${P1}|M`, quantity: 1, unit_price: 100, total_price: 100 },
      { product_id: P1, line_key: `${P1}|L`, quantity: 1, unit_price: 100, total_price: 100 },
    ]);
    const mId = String(cart.items[0]._id);
    await service.removeLine('u1', mId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].line_key).toBe(`${P1}|L`);
    expect(cart.subtotal).toBe(100);
  });

  it('removing a line that is already gone succeeds without saving', async () => {
    const { service, cart } = build([
      { product_id: P1, quantity: 1, unit_price: 100, total_price: 100 },
    ]);
    await service.removeLine('u1', new Types.ObjectId().toString());
    expect(cart.items).toHaveLength(1);
    expect(cart.save).not.toHaveBeenCalled();
  });

  it('sets one line’s quantity, and refuses a line that is not there', async () => {
    const { service, cart } = build([
      { product_id: P1, quantity: 1, unit_price: 2500, total_price: 2500 },
    ]);
    await service.updateLine('u1', String(cart.items[0]._id), 4);
    expect(cart.items[0].quantity).toBe(4);
    expect(cart.items[0].total_price).toBe(10000);
    await expect(
      service.updateLine('u1', new Types.ObjectId().toString(), 2),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a guest merge adds only what the account lacks, so running it twice adds nothing', async () => {
    const { service, cart } = build([
      { product_id: P1, line_key: `${P1}|M`, quantity: 3, unit_price: 100, total_price: 300 },
    ]);
    const guest = [
      { productId: P1, quantity: 1, lineKey: `${P1}|M`, size: 'M' },
      { productId: P2, quantity: 2, lineKey: `${P2}|`, size: undefined },
      { productId: 'gone', quantity: 1, lineKey: 'gone|' },
    ];
    const first = await service.mergeGuestCart('u1', guest);
    expect(first.skipped).toEqual(['gone']);
    expect(cart.items).toHaveLength(2);
    expect(cart.items.find((i: any) => i.line_key === `${P1}|M`).quantity).toBe(3);
    expect(cart.items.find((i: any) => i.line_key === `${P2}|`).quantity).toBe(2);

    await service.mergeGuestCart('u1', guest);
    expect(cart.items).toHaveLength(2);
    expect(cart.items.find((i: any) => i.line_key === `${P2}|`).quantity).toBe(2);
  });
});
