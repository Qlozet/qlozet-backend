import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderValidationService } from './orders.validation';

/**
 * A made-to-order piece is cut from the customer's measurements, so a line
 * may carry no fabric or size pick at all (the vendor's own cloth, or a fabric
 * bought from another vendor). A ready-to-wear piece is already made and can't
 * be paired with someone else's fabric.
 */
describe('made-to-order order lines', () => {
  const build = (clothingType: 'customize' | 'non_customize') => {
    const product = {
      _id: new Types.ObjectId(),
      kind: 'clothing',
      business: new Types.ObjectId(),
      base_price: 30000,
      clothing: { type: clothingType, color_variants: [], fabrics: [], styles: [], accessories: [] },
    };
    const productModel: any = { findById: jest.fn(async () => product) };
    const service = new OrderValidationService(productModel, {} as any);
    jest.spyOn(service as any, 'assertVendorMaySell').mockResolvedValue(undefined);
    return { service, product };
  };

  it('accepts a made-to-order line with no fabric or size choice', async () => {
    const { service, product } = build('customize');
    await expect(
      service.validateOrderItem({ product_id: product._id, quantity: 1, selections: {} } as any),
    ).resolves.toBeDefined();
  });

  it('accepts a made-to-order line cut from another vendor\'s fabric', async () => {
    const { service, product } = build('customize');
    await expect(
      service.validateOrderItem({
        product_id: product._id,
        quantity: 1,
        selections: {},
        applied_fabric_id: new Types.ObjectId(),
        applied_fabric_yards: 4,
      } as any),
    ).resolves.toBeDefined();
  });

  it('refuses another vendor\'s fabric on a ready-to-wear piece', async () => {
    const { service, product } = build('non_customize');
    await expect(
      service.validateOrderItem({
        product_id: product._id,
        quantity: 1,
        selections: {},
        applied_fabric_id: new Types.ObjectId(),
      } as any),
    ).rejects.toThrow(/Only made-to-order pieces/);
  });

  it('still asks a ready-to-wear line for its size', async () => {
    const { service, product } = build('non_customize');
    await expect(
      service.validateOrderItem({ product_id: product._id, quantity: 1, selections: {} } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
