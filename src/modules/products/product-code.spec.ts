import { Types } from 'mongoose';
import { ProductSchema } from './schemas/product.schema';
import { BusinessSchema } from '../business/schemas/business.schema';
import { ProductService } from './products.service';
import { newProductCode, parseProductKey } from './product-code';
import { MemoryMongo, stubLogger } from '../../test-utils/memory-mongo';

/**
 * Product addresses: shop.qlozet.app/p/<name>-<code>. The name part is never
 * looked up, so a rename doesn't break a link; the stored code finds it.
 */
describe('Product address codes - parsing', () => {
  it('reads the code off the end of an address, or an old id', () => {
    expect(parseProductKey('blue-agbada-set-k3x9q2m7')).toEqual({ code: 'k3x9q2m7' });
    expect(parseProductKey('k3x9q2m7')).toEqual({ code: 'k3x9q2m7' });
    expect(parseProductKey('Blue-Agbada-K3X9Q2M7')).toEqual({ code: 'k3x9q2m7' });
    // The name is ignored: a renamed product still opens.
    expect(parseProductKey('old-name-k3x9q2m7')).toEqual({ code: 'k3x9q2m7' });
    expect(parseProductKey('6a4a0bfcc7599e9a605ac269')).toEqual({ id: '6a4a0bfcc7599e9a605ac269' });
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'agbada', 'agbada-short', 'agbada-k3x9q2m', 'agbada-k3x9q2m7z', 'a-k3x9q2m!', undefined]) {
      expect(parseProductKey(bad)).toBeNull();
    }
  });

  it('makes 8-character lowercase codes', () => {
    for (let i = 0; i < 200; i++) expect(newProductCode()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('Product address codes - stored', () => {
  const mongo = new MemoryMongo();
  let productModel: any;
  const business = new Types.ObjectId();
  const base = { kind: 'clothing', base_price: 1000, business };

  beforeAll(async () => {
    await mongo.start();
    mongo.model('Business', BusinessSchema); // the lookup populates the store
    productModel = mongo.model('Product', ProductSchema);
    await productModel.init();
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await productModel.deleteMany({});
  });

  it('gives every new product a code, however it is created', async () => {
    const a = await productModel.create(base);
    const [b, c] = await productModel.insertMany([base, base]);
    const d = await new productModel(base).save();
    const codes = [a, b, c, d].map((p: any) => p.code);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(new Set(codes).size).toBe(4);
    const saved = await productModel.find({}).lean();
    expect(saved.map((p: any) => p.code).sort()).toEqual([...codes].sort());
  });

  it('keeps the code when a product is edited', async () => {
    const a = await productModel.create(base);
    const code = a.code;
    a.base_price = 2000;
    await a.save();
    expect((await productModel.findById(a._id).lean()).code).toBe(code);
  });

  it('never invents a code in memory for an old product', async () => {
    // A schema default would, and a link built from it would lead nowhere.
    const { insertedId } = await productModel.collection.insertOne({ ...base });
    const loaded = await productModel.findById(insertedId);
    expect(loaded.code).toBeUndefined();
    expect(loaded.toJSON().code).toBeUndefined();
  });

  it('many products without a code do not clash on the unique index', async () => {
    await productModel.collection.insertOne({ ...base });
    await expect(productModel.collection.insertOne({ ...base })).resolves.toBeTruthy();
  });

  it('the public product lookup finds a product by its address', async () => {
    const product = await productModel.create(base);
    const service: any = Object.create(ProductService.prototype);
    Object.assign(service, { logger: stubLogger, productModel });
    service.getStockThresholds = async () => ({});
    service.assertPubliclyVisible = async () => undefined;

    const byAddress = await service.findByIdWithAvailability(`blue-agbada-${product.code}`);
    expect(String(byAddress._id)).toBe(String(product._id));
    const byId = await service.findByIdWithAvailability(String(product._id));
    expect(byId.code).toBe(product.code);
    await expect(service.findByIdWithAvailability('blue-agbada-zzzzzzzz')).rejects.toMatchObject({ status: 404 });
    await expect(service.findByIdWithAvailability('nonsense')).rejects.toMatchObject({ status: 404 });
  });
});
