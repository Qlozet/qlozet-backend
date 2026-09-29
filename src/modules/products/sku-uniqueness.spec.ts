import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { ProductService } from './products.service';

/**
 * SKU uniqueness. A SKU identifies a vendor's OWN stock, so it must be unique
 * within their catalogue and is deliberately not unique platform-wide — two
 * vendors arriving with "SHIRT-001" must both keep it.
 */
describe('SKU uniqueness', () => {
  const vendorA = new Types.ObjectId();
  const vendorB = new Types.ObjectId();

  /** Products already saved, keyed by the vendor that owns them. */
  let saved: { business: Types.ObjectId; skus: string[]; name: string }[];
  let service: any;

  beforeEach(() => {
    saved = [];
    service = Object.create(ProductService.prototype);
    Object.assign(service, {
      productModel: {
        // Mirrors the real query: same business, excluding the product being
        // edited, matching any of the supplied SKU patterns.
        findOne: (filter: any) => ({
          select: () => ({
            lean: async () => {
              const patterns: RegExp[] =
                filter.$or?.[0]?.['clothing.color_variants.variants.sku']?.$in ??
                [];
              const excluded = filter._id?.$ne;
              const hit = saved.find(
                (p) =>
                  String(p.business) === String(filter.business) &&
                  String((p as any).id ?? '') !== String(excluded ?? '\0') &&
                  p.skus.some((sku) => patterns.some((rx) => rx.test(sku))),
              );
              return hit ? { clothing: { name: hit.name } } : null;
            },
          }),
        }),
      },
    });
  });

  const clothingWith = (...skus: (string | undefined)[]) => ({
    clothing: {
      color_variants: [
        {
          name: 'Navy',
          variants: skus.map((sku, i) => ({ size: ['S', 'M', 'L'][i], sku })),
        },
      ],
    },
  });

  it('ignores blank and missing SKUs — most variants have none', async () => {
    // Two empty strings are not "duplicates"; treating them as such would make
    // the product unsaveable, since the console defaults sku to ''.
    await expect(
      service.assertSkusAreUnique(clothingWith('', '', undefined), vendorA),
    ).resolves.toBeUndefined();
  });

  it('rejects the same SKU twice in one product, naming both places', async () => {
    await expect(
      service.assertSkusAreUnique(clothingWith('NVY-M', 'NVY-M'), vendorA),
    ).rejects.toThrow(/"NVY-M" is used twice.*Navy \/ S.*Navy \/ M/is);
  });

  it('treats SKUs case-insensitively within a product', async () => {
    await expect(
      service.assertSkusAreUnique(clothingWith('nvy-m', 'NVY-M'), vendorA),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a SKU already used on the vendor's other product, naming it", async () => {
    saved.push({ business: vendorA, skus: ['NVY-M'], name: 'Royal Agbada' });

    await expect(
      service.assertSkusAreUnique(clothingWith('NVY-M'), vendorA),
    ).rejects.toThrow(/already used on "Royal Agbada"/i);
  });

  it('lets a DIFFERENT vendor use the same SKU', async () => {
    saved.push({ business: vendorA, skus: ['SHIRT-001'], name: 'Kemi Shirt' });

    await expect(
      service.assertSkusAreUnique(clothingWith('SHIRT-001'), vendorB),
    ).resolves.toBeUndefined();
  });

  it('does not clash a product with itself when editing', async () => {
    const productId = new Types.ObjectId().toString();
    saved.push({
      business: vendorA,
      skus: ['NVY-M'],
      name: 'Royal Agbada',
      ...({ id: productId } as any),
    });

    await expect(
      service.assertSkusAreUnique(clothingWith('NVY-M'), vendorA, productId),
    ).resolves.toBeUndefined();
  });

  it('matches whole SKUs, not substrings', async () => {
    saved.push({ business: vendorA, skus: ['NVY-M-EXTRA'], name: 'Other' });

    // "NVY-M" must not collide with "NVY-M-EXTRA".
    await expect(
      service.assertSkusAreUnique(clothingWith('NVY-M'), vendorA),
    ).resolves.toBeUndefined();
  });

  it('handles regex-special characters in a SKU', async () => {
    // An unescaped "." would match any character and produce phantom clashes.
    saved.push({ business: vendorA, skus: ['NVYxM'], name: 'Other' });

    await expect(
      service.assertSkusAreUnique(clothingWith('NVY.M'), vendorA),
    ).resolves.toBeUndefined();
  });

  it('checks accessory and fabric variants too', async () => {
    await expect(
      service.assertSkusAreUnique(
        { accessory: { variants: [{ size: 'One', sku: 'A1' }, { size: 'Two', sku: 'A1' }] } },
        vendorA,
      ),
    ).rejects.toThrow(/"A1" is used twice/i);

    await expect(
      service.assertSkusAreUnique(
        { fabric: { variants: [{ size: '5yd', sku: 'F1' }, { size: '10yd', sku: 'F1' }] } },
        vendorA,
      ),
    ).rejects.toThrow(/"F1" is used twice/i);
  });
});
