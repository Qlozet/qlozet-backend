import { Types } from 'mongoose';
import { BespokeService } from './bespoke.service';
import {
  hasUsableMeasurements,
  NO_MEASUREMENTS_MESSAGE,
} from '../../common/utils/usable-measurements';

/**
 * A piece made to fit cannot be cut from nothing. Accepting a bespoke quote
 * freezes the customer's measurements onto the order; with none, the tailor
 * got a blank sheet. Acceptance now refuses first, before any order or
 * charge exists.
 */
describe('Measurements are required for made-to-fit orders', () => {
  describe('hasUsableMeasurements', () => {
    it('accepts a set with real values', () => {
      expect(hasUsableMeasurements({ chest: 96, waist: 82, hip: 100 })).toBe(true);
    });

    it('refuses a missing, empty or zeroed set', () => {
      expect(hasUsableMeasurements(null)).toBe(false);
      expect(hasUsableMeasurements({})).toBe(false);
      expect(hasUsableMeasurements({ chest: 0, waist: 0, hip: 0, height: 0 })).toBe(false);
      expect(hasUsableMeasurements({ chest: 96, waist: 'n/a' })).toBe(false);
    });
  });

  describe('accepting a bespoke quote', () => {
    const customerId = new Types.ObjectId().toString();
    const quoteId = new Types.ObjectId().toString();

    const build = (measurementSets: any[]) => {
      const orderLookups = jest.fn(async () => null);
      const service: any = Object.create(BespokeService.prototype);
      Object.assign(service, {
        logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
        quoteModel: {
          findOne: async () => ({
            _id: quoteId,
            status: 'submitted',
            expires_at: new Date(Date.now() + 86_400_000),
            design: new Types.ObjectId(),
          }),
        },
        designModel: { findById: async () => ({ _id: 'd1', reference: 'DSN-1' }) },
        userModel: {
          findById: () => ({
            select: () => ({ lean: async () => ({ measurementSets }) }),
          }),
        },
        orderModel: { findOne: orderLookups },
      });
      return { service, orderLookups };
    };

    it('refuses when the customer has no measurements, touching no orders', async () => {
      const { service, orderLookups } = build([]);
      await expect(
        service.acceptQuote(quoteId, { id: customerId }, 'wallet'),
      ).rejects.toThrow(NO_MEASUREMENTS_MESSAGE);
      expect(orderLookups).not.toHaveBeenCalled();
    });

    it('refuses when the chosen set is empty', async () => {
      const { service } = build([{ name: 'Me', active: true, measurements: {} }]);
      await expect(
        service.acceptQuote(quoteId, { id: customerId }, 'wallet', undefined, 'Me'),
      ).rejects.toThrow(NO_MEASUREMENTS_MESSAGE);
    });

    it('goes past the check when the set has measurements', async () => {
      const { service, orderLookups } = build([
        { name: 'Me', active: true, measurements: { chest: 96, waist: 82, hip: 100 } },
      ]);
      // It continues into the order logic, which these stubs do not cover;
      // reaching the order lookup is the proof the gate let it through.
      await service.acceptQuote(quoteId, { id: customerId }, 'wallet').catch(() => undefined);
      expect(orderLookups).toHaveBeenCalled();
    });
  });
});
