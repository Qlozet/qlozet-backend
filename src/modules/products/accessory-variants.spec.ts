import { Connection } from 'mongoose';
import { MemoryMongo } from '../../test-utils/memory-mongo';
import { Product, ProductSchema } from './schemas/product.schema';

/**
 * Accessory variants round-trip.
 *
 * The schema declared { color, size: [String], stock } and nothing else, while
 * the vendor console sends one row per size with a single `size`, a `sku` and
 * images. Mongoose drops unknown paths without complaint, so the API answered
 * 201 and stored a fraction of what was sent.
 */
describe('Accessory variants', () => {
  const mongo = new MemoryMongo();
  let connection: Connection;
  let productModel: any;

  beforeAll(async () => {
    connection = await mongo.start();
    productModel = mongo.model(Product.name, ProductSchema);
  });

  afterAll(() => mongo.stop());

  const accessory = (variants: any[]) => ({
    kind: 'accessory',
    business: '507f1f77bcf86cd799439011',
    base_price: 5000,
    accessory: {
      name: 'Leather Belt',
      price: 5000,
      taxonomy: {
        product_type: 'accessory',
        categories: ['Belt'],
        audience: 'unisex',
      },
      variants,
    },
  });

  it('stores everything the vendor console sends', async () => {
    const created = await productModel.create(
      accessory([
        {
          color: { name: 'Black', hex: '#000000' },
          size: 'M',
          stock: 12,
          sku: 'BELT-BLK-M',
          images: [{ url: 'https://cdn/belt-black.jpg', public_id: 'belt' }],
        },
      ]),
    );

    const [variant] = created.accessory.variants;
    expect(variant.size).toBe('M');
    expect(variant.stock).toBe(12);
    expect(variant.color.name).toBe('Black');
    // The three that used to be dropped.
    expect(variant.sku).toBe('BELT-BLK-M');
    expect(variant.images).toHaveLength(1);
    expect(variant._id).toBeDefined();
  });

  it('accepts a size-only variant — a cap has no colour', async () => {
    // Previously `color` was required, so this threw and took the whole
    // product save with it.
    const created = await productModel.create(
      accessory([{ size: 'One size', stock: 4 }]),
    );
    expect(created.accessory.variants[0].size).toBe('One size');
  });

  it('accepts a colour-only variant, and defaults its stock', async () => {
    const created = await productModel.create(
      accessory([{ color: { name: 'Tan', hex: '#D2B48C' } }]),
    );
    expect(created.accessory.variants[0].color.name).toBe('Tan');
    expect(created.accessory.variants[0].stock).toBe(0);
  });

  it('reads a legacy row whose size was stored as an array', async () => {
    // Documents written under the old schema hold size: ['M']. Reading them
    // back through the String path must not throw, or every product saved
    // before this change becomes unopenable.
    const raw = connection.collection('products');
    const { insertedId } = await raw.insertOne(
      accessory([{ color: { name: 'Black', hex: '#000' }, size: ['M'], stock: 3 }]) as any,
    );

    const found = await productModel.findById(insertedId);

    // It does NOT throw - the product stays openable, which is the thing that
    // mattered. But mongoose cannot cast an array into a String path, so it
    // hands back undefined: the row keeps its colour and stock and loses its
    // size label. `npm run migrate:accessory-variant-size` flattens these.
    expect(found).toBeTruthy();
    expect(found.accessory.variants[0].stock).toBe(3);
    expect(found.accessory.variants[0].color.name).toBe('Black');
    expect(found.accessory.variants[0].size).toBeUndefined();
  });
});
