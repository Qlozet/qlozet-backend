import { BadRequestException } from '@nestjs/common';
import { BusinessService, } from './business.service';
import { BusinessStatus } from './schemas/business.schema';
import {
  SERVICE_AGREEMENT,
  hasAcceptedCurrentAgreement,
} from './service-agreement';

/**
 * The admin's decision on a vendor awaiting review.
 *
 * Two fields move together and must not drift: the trading status the
 * catalogue and checkout gate on, and the verification state the vendor's
 * dashboard reads.
 */
describe('Verification decision', () => {
  let saved: Record<string, any>;
  let statusCalls: string[];
  let service: any;

  beforeEach(() => {
    saved = {};
    statusCalls = [];
    service = Object.create(BusinessService.prototype);
    Object.assign(service, {
      businessModel: {
        findById: async () => ({ verification_attempts: 0 }),
        updateOne: async (_filter: any, update: any) => {
          Object.assign(saved, update.$set);
          return { modifiedCount: 1 };
        },
      },
      updateBusinessStatus: async (_id: string, status: string) => {
        statusCalls.push(status);
        return { message: 'ok' };
      },
    });
  });

  const decide = (decision: string, message?: string) =>
    service.decideVerification('507f1f77bcf86cd799439011', decision, message);

  it('approving marks the vendor verified and clears the message', async () => {
    await decide('approved');
    expect(saved.verification_state).toBe('approved');
    expect(saved.verification_message).toBeNull();
    // Routed through updateBusinessStatus so the one-time signup reward still
    // fires on the first transition into a live state.
    expect(statusCalls).toEqual([BusinessStatus.VERIFIED]);
  });

  it('action required grants exactly one more attempt', async () => {
    await decide('action_required', 'Your bank account name does not match your ID.');
    expect(saved.verification_state).toBe('action_required');
    expect(saved.verification_attempts_allowed).toBe(1);
    // Back to pending: not sellable, and not in the review queue either,
    // because the next move is the vendor's.
    expect(statusCalls).toEqual([BusinessStatus.PENDING]);
  });

  it('only ever writes a status the schema accepts', async () => {
    // This shipped broken: 'unverified' was passed here and is not in the
    // enum, so every "needs fixing" decision died with a 500 at save time.
    // updateBusinessStatus advertised it as valid, which is why it typechecked.
    const allowed = Object.values(BusinessStatus);
    for (const [decision, message] of [
      ['approved', undefined],
      ['action_required', 'fix this'],
      ['rejected', 'no'],
    ] as const) {
      statusCalls = [];
      await decide(decision, message);
      for (const status of statusCalls) {
        expect(allowed).toContain(status);
      }
    }
  });

  it('refuses action required with no message', async () => {
    // "Action required" with no action named is a rejection with extra steps.
    await expect(decide('action_required', '   ')).rejects.toThrow(
      /Say what the vendor needs to fix/i,
    );
  });

  it('refuses a rejection with no reason', async () => {
    await expect(decide('rejected')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejecting stores the reason and stops trading', async () => {
    await decide('rejected', 'The CAC registration belongs to another company.');
    expect(saved.verification_message).toMatch(/another company/);
    expect(statusCalls).toEqual([BusinessStatus.REJECTED]);
  });

  it('records when the decision was made', async () => {
    await decide('approved');
    expect(saved.verification_decided_at).toBeInstanceOf(Date);
  });
});

describe('Service agreement', () => {
  it('counts only the version currently in force', () => {
    expect(
      hasAcceptedCurrentAgreement({
        service_agreement: { version: SERVICE_AGREEMENT.VERSION },
      }),
    ).toBe(true);
  });

  it('treats an older signature as unsigned, so the vendor is re-prompted', () => {
    // Silently applying new terms to someone who accepted older ones is the
    // thing the version exists to prevent.
    expect(
      hasAcceptedCurrentAgreement({ service_agreement: { version: '2020-01-01' } }),
    ).toBe(false);
  });

  it('treats a missing record as unsigned', () => {
    expect(hasAcceptedCurrentAgreement({})).toBe(false);
    expect(hasAcceptedCurrentAgreement({ service_agreement: null })).toBe(false);
  });
});
