import { Types } from 'mongoose';
import { ProductService } from './products.service';

// A bespoke order made with the tailor's own fabric product. Orders made
// before 31 Oct 2026 stored the PRODUCT id as fabric_id; newer ones store
// product.fabric._id. Paying for either must take the yards off the stock.
describe('bespoke fabric stock deduction', () => {
  const productId = new Types.ObjectId();
  const fabricSubId = new Types.ObjectId();

  function build() {
    const product: any = {
      _id: productId,
      fabric: { _id: fabricSubId, name: 'Ankara', yard_length: 10 },
    };
    const updates: any[] = [];
    const q = (v: any) => ({ session: () => Promise.resolve(v) });
    const svc: any = Object.create(ProductService.prototype);
    svc.logger = { log: () => undefined };
    svc.fabricModel = { findById: () => q(null) };
    svc.productModel = {
      findById: () => q(product),
      updateOne: (filter: any, update: any) => {
        updates.push({ filter, update });
        return { session: () => Promise.resolve({ matchedCount: 1 }) };
      },
    };
    return { svc, updates };
  }

  it.each([
    ['product id (older orders)', productId],
    ['fabric id (current shape)', fabricSubId],
  ])('deducts when fabric_id is the %s', async (_label, fid) => {
    const { svc, updates } = build();
    await svc.updateFabric(
      {
        product: productId,
        fabric_selections: [{ fabric_id: String(fid), yardage: 3, quantity: 1 }],
      },
      undefined,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toEqual({ $set: { 'fabric.yard_length': 7 } });
  });

  it('still refuses an unknown fabric', async () => {
    const { svc } = build();
    await expect(
      svc.updateFabric(
        {
          product: productId,
          fabric_selections: [
            { fabric_id: String(new Types.ObjectId()), yardage: 1 },
          ],
        },
        undefined,
      ),
    ).rejects.toThrow('not found in product or standalone');
  });

  it("deducts a selection that names its own listing (a bespoke lining from the tailor's stock)", async () => {
    const liningId = new Types.ObjectId();
    const liningFabricId = new Types.ObjectId();
    const lining: any = { _id: liningId, fabric: { _id: liningFabricId, name: 'Silk lining', yard_length: 8 } };
    const updates: any[] = [];
    const looked: string[] = [];
    const q = (v: any) => ({ session: () => Promise.resolve(v) });
    const svc: any = Object.create(ProductService.prototype);
    svc.logger = { log: () => undefined };
    svc.fabricModel = { findById: () => q(null) };
    svc.productModel = {
      findById: (id: any) => {
        looked.push(String(id));
        return q(String(id) === String(liningId) ? lining : null);
      },
      updateOne: (filter: any, update: any) => {
        updates.push({ filter, update });
        return { session: () => Promise.resolve({ matchedCount: 1 }) };
      },
    };
    await svc.updateFabric(
      {
        product: productId,
        fabric_selections: [{ fabric_id: String(liningFabricId), product_id: liningId, yardage: 2, quantity: 1 }],
      },
      undefined,
    );
    expect(looked.every((id) => id === String(liningId))).toBe(true);
    expect(updates[0]).toEqual({
      filter: { _id: liningId },
      update: { $set: { 'fabric.yard_length': 6 } },
    });
  });
});
