import { Types } from 'mongoose';

// The image pipeline's ESM client is never called here.
jest.mock('@gradio/client', () => ({ Client: {}, handle_file: jest.fn() }));
import { MeasurementController } from './measurement.controller';
import { OutfitProcessor } from './queue/outfit.processor';
import { BespokeService } from '../bespoke/bespoke.service';
import { BespokeTemplateSchema } from '../bespoke/schemas/bespoke-template.schema';
import { UserType } from '../ums/schemas/user.schema';
import { MemoryMongo } from '../../test-utils/memory-mongo';

/**
 * The admin template studio refines images and draws their backs through
 * edit-garment-image, free like its generations; templates keep back views.
 */
describe('admin template studio', () => {
  describe('edit-garment-image', () => {
    const make = (type: UserType) => {
      const tokenService = {
        balance: jest.fn().mockResolvedValue(0),
        spend: jest.fn().mockResolvedValue(undefined),
      };
      const outfitService = {
        queueEditGarmentGeneration: jest
          .fn()
          .mockResolvedValue({ data: { jobId: 'j1' } }),
      };
      const controller = new MeasurementController(
        {} as any,
        outfitService as any,
        {} as any,
        {
          getSettings: jest
            .fn()
            .mockResolvedValue({ edit_garment_token_price: 45 }),
        } as any,
        tokenService as any,
        { findById: jest.fn().mockResolvedValue({ type }) } as any,
        {} as any,
      );
      return { controller, tokenService, outfitService };
    };
    const req = { user: { id: 'u1' } };
    const body: any = { base_image_url: 'https://x/a.png', view: 'back' };

    it('is free for platform admins and marks the job unbilled', async () => {
      const { controller, tokenService, outfitService } = make(
        UserType.PLATFORM,
      );
      await controller.editGarmentImage(body, req);
      expect(tokenService.spend).not.toHaveBeenCalled();
      expect(outfitService.queueEditGarmentGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ unbilled: true, view: 'back' }),
      );
    });

    it('still charges customers, and refuses them without tokens', async () => {
      const { controller, tokenService, outfitService } = make(
        UserType.CUSTOMER,
      );
      await expect(controller.editGarmentImage(body, req)).rejects.toThrow(
        'Insufficient tokens',
      );
      tokenService.balance.mockResolvedValue(100);
      await controller.editGarmentImage(body, req);
      expect(tokenService.spend).toHaveBeenCalledWith('edit', undefined, 'u1');
      expect(
        outfitService.queueEditGarmentGeneration.mock.calls[0][0].unbilled,
      ).toBeUndefined();
    });
  });

  describe('a failed job', () => {
    const run = async (data: any) => {
      const refund = jest.fn().mockResolvedValue(null);
      const processor = new OutfitProcessor(
        {
          editGarmentWithImageEditor: jest
            .fn()
            .mockRejectedValue(new Error('editor down')),
        } as any,
        { updateStatus: jest.fn().mockResolvedValue(undefined) } as any,
        { refund } as any,
        {} as any,
      );
      (processor as any).logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      await expect(
        processor.process({
          id: 'j1',
          data: { type: 'editGarment', ...data },
        } as any),
      ).rejects.toThrow('editor down');
      return refund;
    };

    it('refunds a customer', async () => {
      expect(await run({ customer: 'c1' })).toHaveBeenCalledWith(
        'edit',
        undefined,
        'c1',
      );
    });

    it('gives nothing back for an unbilled admin job', async () => {
      expect(
        await run({ customer: 'admin1', unbilled: true }),
      ).not.toHaveBeenCalled();
    });
  });

  describe('template back views', () => {
    const mongo = new MemoryMongo();
    let service: BespokeService;
    let model: any;

    beforeAll(async () => {
      await mongo.start();
      model = mongo.model('BespokeTemplate', BespokeTemplateSchema);
      service = Object.create(BespokeService.prototype);
      (service as any).templateModel = model;
    }, 120_000);
    afterAll(() => mongo.stop());
    const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

    it('keeps one back per image the template still has', async () => {
      const { data } = await service.adminCreateTemplate(
        {
          name: 'Agbada',
          category: 'Agbada',
          gender: 'men',
          design_images: ['a', 'b'],
          back_views: [
            { front: 'a', back: 'a-back' },
            { front: 'a', back: 'dup' },
            { front: 'gone', back: 'x' },
          ],
        },
        new Types.ObjectId().toString(),
      );
      expect(plain(data.back_views)).toEqual([{ front: 'a', back: 'a-back' }]);

      // Dropping an image drops its back.
      const id = String(data._id);
      const updated = await service.adminUpdateTemplate(id, {
        design_images: ['b'],
      });
      expect(plain(updated.data.back_views)).toEqual([]);

      const again = await service.adminUpdateTemplate(id, {
        back_views: [{ front: 'b', back: 'b-back' }],
      });
      expect(plain(again.data.back_views)).toEqual([
        { front: 'b', back: 'b-back' },
      ]);
    });
  });
});
