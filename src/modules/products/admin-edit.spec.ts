import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';

import { ProductService } from './products.service';
import { AdminUpdateProductDto } from './dto/admin-products.dto';

/**
 * The Qlozet team may tidy a vendor's listing (name, description, category,
 * a bad photo) but never its price, stock or options, and the vendor is
 * always told what changed and why.
 */
describe('admin listing edits', () => {
  const makeProduct = (over: Record<string, any> = {}) => {
    const product: any = {
      _id: new Types.ObjectId(),
      business: new Types.ObjectId(),
      kind: 'clothing',
      base_price: 30000,
      seo: { title: 'Old name here' },
      clothing: {
        name: 'Old name here',
        description: 'Call me on 0803 123 4567',
        taxonomy: { product_type: 'Top', categories: ['Shirt'], audience: 'men' },
        images: [{ url: 'a.jpg' }, { url: 'b.jpg' }],
        color_variants: [{ name: 'Blue', variants: [{ size: 'M', stock: 3, price: 0 }] }],
      },
      admin_edits: [],
      markModified: jest.fn(),
      save: jest.fn(async () => undefined),
      toJSON() {
        return this;
      },
      ...over,
    };
    return product;
  };

  const makeService = (product: any) => {
    const service = Object.create(ProductService.prototype) as ProductService;
    (service as any).assertProduct = jest.fn(async () => product);
    const notify = jest.fn(async () => undefined);
    (service as any).notifyVendorOfProduct = notify;
    return { service, notify };
  };

  it('fixes the text and category, records why, and tells the vendor', async () => {
    const product = makeProduct();
    const { service, notify } = makeService(product);
    const adminId = new Types.ObjectId().toHexString();
    await service.adminUpdate(
      String(product._id),
      {
        reason: 'Removed a phone number from the description.',
        name: 'Blue linen shirt',
        description: 'A relaxed linen shirt.',
        categories: ['Shirt', 'Linen'],
      } as any,
      adminId,
    );
    expect(product.clothing.name).toBe('Blue linen shirt');
    expect(product.seo.title).toBe('Blue linen shirt');
    expect(product.clothing.taxonomy.categories).toEqual(['Shirt', 'Linen']);
    expect(product.admin_edits).toHaveLength(1);
    expect(product.admin_edits[0].reason).toBe('Removed a phone number from the description.');
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as any[])[3]).toContain('Reason: Removed a phone number');
    // Untouched: the vendor's money and stock.
    expect(product.base_price).toBe(30000);
    expect(product.clothing.color_variants[0].variants[0].stock).toBe(3);
  });

  it('takes a photo down but never the last one', async () => {
    const product = makeProduct();
    const { service } = makeService(product);
    await service.adminUpdate(String(product._id), {
      reason: 'Photo shows a watermark with a phone number.',
      remove_images: ['a.jpg'],
    } as any);
    expect(product.clothing.images).toEqual([{ url: 'b.jpg' }]);
    await expect(
      service.adminUpdate(String(product._id), {
        reason: 'Photo shows a watermark with a phone number.',
        remove_images: ['b.jpg'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an edit that changes nothing', async () => {
    const product = makeProduct();
    const { service, notify } = makeService(product);
    await expect(
      service.adminUpdate(String(product._id), { reason: 'Just checking the listing.' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notify).not.toHaveBeenCalled();
  });

  it('edits a fabric’s material and type', async () => {
    const product = makeProduct({
      kind: 'fabric',
      clothing: undefined,
      fabric: { name: 'Blue wax', product_type: 'Cotton', pattern: 'Ankara', images: [{ url: 'x.jpg' }] },
    });
    const { service } = makeService(product);
    await service.adminUpdate(String(product._id), {
      reason: 'Filed under the right fabric type.',
      pattern: 'Wax Print',
    } as any);
    expect(product.fabric.pattern).toBe('Wax Print');
  });

  it('has no way to send a price, stock or status', async () => {
    const dto = plainToInstance(AdminUpdateProductDto, {
      reason: 'Short',
      base_price: 1,
      status: 'archived',
      clothing: { color_variants: [] },
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('reason');
    expect('base_price' in AdminUpdateProductDto.prototype).toBe(false);
  });
});
