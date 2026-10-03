import { VerificationController } from './verification.controller';
import { VerificationState } from '../business/schemas/business.schema';

/**
 * How the provider checks drive the state machine.
 *
 * Without this, `POST /verification/submit` — which requires
 * PROVIDER_COMPLETE — could never be satisfied, and a vendor would sign the
 * agreement only to find Submit permanently refused.
 */
describe('Verification state from checks', () => {
  let stored: any;
  let written: any;
  let controller: any;

  beforeEach(() => {
    written = null;
    controller = Object.create(VerificationController.prototype);
    Object.assign(controller, {
      businessModel: {
        findById: () => ({ select: () => ({ lean: async () => stored }) }),
        updateOne: async (_f: any, update: any) => {
          written = update.$set;
          return { modifiedCount: 1 };
        },
      },
    });
  });

  const run = (business: any) => {
    stored = business;
    return controller.refreshVerificationState('507f1f77bcf86cd799439011');
  };

  const pass = { status: 'verified' };
  const fail = { status: 'failed' };

  it('is provider_complete only when identity, CAC and bank all pass', async () => {
    await run({
      verification_state: VerificationState.IN_PROGRESS,
      verification: { identity: pass, business: pass, bank: pass },
    });
    expect(written.verification_state).toBe(VerificationState.PROVIDER_COMPLETE);
  });

  it('is in_progress while any check is still outstanding', async () => {
    await run({
      verification_state: VerificationState.NOT_STARTED,
      verification: { identity: pass },
    });
    expect(written.verification_state).toBe(VerificationState.IN_PROGRESS);
  });

  it('a failed check does not count as done', async () => {
    // Identity alone used to set status "verified", putting a vendor in the
    // catalogue with no bank account, no CAC and no human review.
    await run({
      verification_state: VerificationState.IN_PROGRESS,
      verification: { identity: pass, business: pass, bank: fail },
    });
    expect(written).toBeNull(); // already in_progress; nothing to change
  });

  it('never pulls a business back out of review', async () => {
    await run({
      verification_state: VerificationState.AWAITING_REVIEW,
      verification: { identity: pass, business: pass, bank: pass },
    });
    expect(written).toBeNull();
  });

  it('never undoes an approval', async () => {
    await run({
      verification_state: VerificationState.APPROVED,
      verification: { identity: pass, business: pass, bank: fail },
    });
    expect(written).toBeNull();
  });

  it('never revives a rejected business', async () => {
    await run({
      verification_state: VerificationState.REJECTED,
      verification: { identity: pass, business: pass, bank: pass },
    });
    expect(written).toBeNull();
  });

  describe('liveness', () => {
    it('is required once a workflow session exists', async () => {
      // The hosted workflow is how a camera gets involved at all. A run that
      // skipped the selfie has not proved the document holder is present.
      await run({
        verification_state: VerificationState.IN_PROGRESS,
        verification: {
          session: { session_id: 'sess_1' },
          identity: pass,
          business: pass,
          bank: pass,
        },
      });
      expect(written).toBeNull(); // liveness missing — still in_progress
    });

    it('completes a workflow run once liveness passes too', async () => {
      await run({
        verification_state: VerificationState.IN_PROGRESS,
        verification: {
          session: { session_id: 'sess_1' },
          identity: pass,
          business: pass,
          bank: pass,
          liveness: pass,
        },
      });
      expect(written.verification_state).toBe(
        VerificationState.PROVIDER_COMPLETE,
      );
    });

    it('is not required of a vendor who used the per-check endpoints', async () => {
      // Those cannot do liveness at all, so requiring it would leave anyone
      // mid-migration permanently unable to finish.
      await run({
        verification_state: VerificationState.IN_PROGRESS,
        verification: { identity: pass, business: pass, bank: pass },
      });
      expect(written.verification_state).toBe(
        VerificationState.PROVIDER_COMPLETE,
      );
    });

    it('does not let a failed liveness complete a workflow run', async () => {
      await run({
        verification_state: VerificationState.IN_PROGRESS,
        verification: {
          session: { session_id: 'sess_1' },
          identity: pass,
          business: pass,
          bank: pass,
          liveness: fail,
        },
      });
      expect(written).toBeNull();
    });
  });

  it('writes nothing when the state is already right', async () => {
    await run({
      verification_state: VerificationState.PROVIDER_COMPLETE,
      verification: { identity: pass, business: pass, bank: pass },
    });
    expect(written).toBeNull();
  });
});
