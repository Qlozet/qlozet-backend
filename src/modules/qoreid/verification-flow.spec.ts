import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { BusinessSchema } from '../business/schemas/business.schema';
import { MemoryMongo } from '../../test-utils/memory-mongo';

/**
 * Verification flow — two contracts matter most:
 * 1. Data minimisation: the raw vNIN is NEVER persisted, only a masked tail.
 * 2. A clean identity pass promotes the business to 'verified' — but never
 *    overrides an admin's 'rejected'.
 */
describe('VerificationController', () => {
  const mongo = new MemoryMongo();
  let businessModel: any;
  let controller: any;
  let qoreid: {
    verifyVnin: jest.Mock;
    verifyNuban: jest.Mock;
    isConfigured: jest.Mock;
  };

  beforeAll(async () => {
    await mongo.start();
    businessModel = mongo.model('Business', BusinessSchema);
  }, 120_000);

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await businessModel.deleteMany({});
    qoreid = {
      verifyVnin: jest.fn(),
      verifyNuban: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    controller = Object.create(VerificationController.prototype);
    Object.assign(controller, { qoreid, businessModel });
  });

  const makeBusiness = (overrides: Record<string, any> = {}) =>
    businessModel.create({
      business_name: 'Adire Studio',
      status: 'approved',
      ...overrides,
    });

  const req = (business: any) => ({
    business: { id: business._id.toString() },
    user: { full_name: 'Bunch Dillon' },
  });

  const passVerdict = {
    verified: true,
    provider_ref: 'QID-123',
    verified_name: 'Bunch Dillon',
    match: 'EXACT_MATCH',
    status: 'verified',
  };

  describe('verifyVnin', () => {
    it('stores only the verdict + masked tail — never the raw vNIN', async () => {
      const business = await makeBusiness();
      qoreid.verifyVnin.mockResolvedValue(passVerdict);

      await controller.verifyVnin(req(business), {
        vnin: 'JZ426633988976CH',
      });

      const saved = await businessModel.findById(business._id).lean();
      expect(saved.verification.identity.masked_id).toBe('***76CH');
      expect(saved.verification.identity.provider_ref).toBe('QID-123');
      // The full vNIN must not appear anywhere on the stored document.
      expect(JSON.stringify(saved)).not.toContain('JZ426633988976CH');
    });

    it('a clean pass promotes the business to verified', async () => {
      const business = await makeBusiness({ status: 'approved' });
      qoreid.verifyVnin.mockResolvedValue(passVerdict);

      const res = await controller.verifyVnin(req(business), {
        vnin: 'JZ426633988976CH',
      });

      expect(res.verified).toBe(true);
      const saved = await businessModel.findById(business._id).lean();
      expect(saved.status).toBe('verified');
    });

    it("never overrides an admin's rejection", async () => {
      const business = await makeBusiness({ status: 'rejected' });
      qoreid.verifyVnin.mockResolvedValue(passVerdict);

      await controller.verifyVnin(req(business), { vnin: 'JZ426633988976CH' });

      const saved = await businessModel.findById(business._id).lean();
      expect(saved.status).toBe('rejected');
      // The identity result is still recorded for the admin to see.
      expect(saved.verification.identity.status).toBe('verified');
    });

    it('a failed match records failure and does not promote', async () => {
      const business = await makeBusiness({ status: 'approved' });
      qoreid.verifyVnin.mockResolvedValue({
        ...passVerdict,
        verified: false,
        match: 'NO_MATCH',
        status: 'not_verified',
      });

      const res = await controller.verifyVnin(req(business), {
        vnin: 'JZ426633988976CH',
      });

      expect(res.verified).toBe(false);
      const saved = await businessModel.findById(business._id).lean();
      expect(saved.status).toBe('approved');
      expect(saved.verification.identity.status).toBe('failed');
    });
  });

  describe('verifyPayoutBank', () => {
    it('requires a linked payout account', async () => {
      const business = await makeBusiness();
      await expect(
        controller.verifyPayoutBank(req(business)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(qoreid.verifyNuban).not.toHaveBeenCalled();
    });

    it('matches the linked account against the identity-verified name', async () => {
      const business = await makeBusiness({
        payout_account_number: '0123456789',
        payout_bank_code: '062',
        payout_bank_name: 'Test Bank',
        verification: {
          identity: { status: 'verified', verified_name: 'Bunch Dillon' },
        },
      });
      qoreid.verifyNuban.mockResolvedValue({
        ...passVerdict,
        account_name: 'BUNCH DILLON',
      });

      const res = await controller.verifyPayoutBank(req(business));

      expect(qoreid.verifyNuban).toHaveBeenCalledWith(
        '0123456789',
        '062',
        'Bunch',
        'Dillon',
      );
      expect(res.verified).toBe(true);
      const saved = await businessModel.findById(business._id).lean();
      expect(saved.verification.bank.account_name).toBe('BUNCH DILLON');
      expect(saved.verification.bank.bank_name).toBe('Test Bank');
    });
  });
});
