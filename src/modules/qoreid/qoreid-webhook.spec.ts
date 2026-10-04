import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import { QoreIdService } from './qoreid.service';

const SECRET = 'whsec_test';

/**
 * The webhook is the only path a verdict may arrive on. The SDK fires a
 * 'success' event in the browser, but a client reporting its own success is
 * not a verification — anyone can post that.
 */
describe('QoreID webhook', () => {
  let saved: Record<string, any>;
  let stored: any;
  let controller: any;

  const qoreid: any = Object.create(QoreIdService.prototype);
  Object.assign(qoreid, {
    config: { get: (key: string) => (key === 'QOREID_WEBHOOK_SECRET' ? SECRET : undefined) },
  });

  beforeEach(() => {
    saved = {};
    stored = {
      _id: '507f1f77bcf86cd799439011',
      verification: {},
      verification_state: 'in_progress',
    };
    controller = Object.create(QoreIdWebhookController.prototype);
    Object.assign(controller, {
      qoreid,
      logger: { warn: () => undefined, error: () => undefined },
      businessModel: {
        findById: () => ({ select: () => ({ lean: async () => stored }) }),
        findOne: () => ({ select: () => ({ lean: async () => null }) }),
        updateOne: async (_f: any, update: any) => {
          Object.assign(saved, update.$set);
          // Reflect writes back so the re-read sees them, as Mongo would.
          for (const [path, value] of Object.entries(update.$set)) {
            if (path.startsWith('verification.')) {
              const key = path.split('.')[1];
              stored.verification[key] = value;
            } else {
              stored[path] = value;
            }
          }
          return { modifiedCount: 1 };
        },
      },
    });
  });

  /** `null` sends no signature header at all; omitting it signs correctly. */
  const post = (body: any, signature?: string | null) => {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (signature !== null) {
      headers['x-verifyme-signature'] =
        signature ?? createHmac('sha512', SECRET).update(raw).digest('hex');
    }
    return controller.handle({ rawBody: Buffer.from(raw), body, headers });
  };

  const payload = (
    summary: Record<string, any>,
    eventType = 'step_verification_completed',
  ) => ({
    event: 'workflow',
    event_type: eventType,
    data: {
      id: 'QID-999',
      customerReference: 'biz_507f1f77bcf86cd799439011_1',
      summary,
      status: { state: 'complete' },
    },
  });

  it('rejects an unsigned webhook', async () => {
    await expect(post(payload({}), null)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a forged signature', async () => {
    await expect(post(payload({}), 'deadbeef')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('records a passing check as verified', async () => {
    await post(payload({ nin_check: { status: 'EXACT_MATCH' } }));
    expect(saved['verification.identity'].status).toBe('verified');
    expect(saved['verification.identity'].provider_ref).toBe('QID-999');
  });

  it('passes a partial match, and records that it was partial', async () => {
    // A Nigerian bank account reading "ADEYEMI KEMI FUNMILAYO" against a NIMC
    // record of "KEMI ADEYEMI" comes back PARTIAL_MATCH and is almost always
    // the same person. Failing it here would reject them before the admin -
    // the one person able to judge it - ever sees the case.
    await post(payload({ nin_check: { status: 'PARTIAL_MATCH' } }));
    expect(saved['verification.identity'].status).toBe('verified');
    expect(saved['verification.identity'].match).toBe('PARTIAL_MATCH');
  });

  it('passes a transposed match for the same reason', async () => {
    await post(payload({ nuban_check: { status: 'TRANSPOSED_MATCH' } }));
    expect(saved['verification.bank'].status).toBe('verified');
  });

  it('still fails a flat NO_MATCH', async () => {
    await post(payload({ nin_check: { status: 'NO_MATCH' } }));
    expect(saved['verification.identity'].status).toBe('failed');
  });

  it('matches the rule the per-check endpoints use', async () => {
    // The two routes into verification must not disagree about the same
    // vendor. QoreIdService.toVerdict passes anything but NO_MATCH.
    await post(payload({ cac_check: { status: 'EXACT_MATCH' } }));
    expect(saved['verification.business'].status).toBe('verified');
  });

  it('only reaches provider_complete once every check has passed', async () => {
    await post(payload({ nin_check: { status: 'EXACT_MATCH' } }));
    expect(saved.verification_state).toBeUndefined(); // already in_progress

    await post(
      payload({
        cac_check: { status: 'EXACT_MATCH' },
        nuban_check: { status: 'EXACT_MATCH' },
      }),
    );
    // Still short: a workflow run also has to pass liveness.
    expect(saved.verification_state).toBeUndefined();

    await post(payload({ liveness_check: { status: 'EXACT_MATCH' } }));
    expect(saved.verification_state).toBe('provider_complete');
  });

  it('a partial match still completes, so the admin gets to decide', async () => {
    await post(
      payload({
        nin_check: { status: 'PARTIAL_MATCH' },
        cac_check: { status: 'EXACT_MATCH' },
        nuban_check: { status: 'EXACT_MATCH' },
        liveness_check: { status: 'EXACT_MATCH' },
      }),
    );
    expect(saved.verification_state).toBe('provider_complete');
  });

  it('records liveness separately from the identity document', async () => {
    // liveness_check used to be aliased to identity, so a passing selfie
    // satisfied the identity requirement — a vendor could finish with no
    // identity document at all, which is the hole liveness exists to close.
    await post(payload({ liveness_check: { status: 'EXACT_MATCH' } }));
    expect(saved['verification.liveness'].status).toBe('verified');
    expect(saved['verification.identity']).toBeUndefined();
  });

  it('reads a passport as the identity document', async () => {
    await post(payload({ passport_check: { status: 'EXACT_MATCH' } }));
    expect(saved['verification.identity'].status).toBe('verified');
  });

  describe('attempts', () => {
    let incremented: Record<string, number> | null;

    beforeEach(() => {
      incremented = null;
      const update = controller.businessModel.updateOne;
      controller.businessModel.updateOne = async (f: any, u: any) => {
        if (u.$inc) incremented = u.$inc;
        return update(f, u);
      };
    });

    it('spends one when the workflow actually starts', async () => {
      // Running the checks is what costs money, so that is what costs the
      // vendor their attempt.
      await post(payload({}, 'verification_started'));
      expect(incremented).toEqual({ verification_attempts: 1 });
    });

    it('spends none on a step starting', async () => {
      // Otherwise a four-step workflow would spend four attempts.
      await post(payload({}, 'step_verification_started'));
      expect(incremented).toBeNull();
    });

    it('spends none on results arriving', async () => {
      await post(payload({ nin_check: { status: 'EXACT_MATCH' } }));
      expect(incremented).toBeNull();
    });
  });

  it('ignores results on a _started event', async () => {
    // verification_started and step_verification_started announce that
    // something is beginning. Reading a verdict off one would mark every
    // check failed the moment it began.
    await post(
      payload({ nin_check: { status: 'PENDING' } }, 'step_verification_started'),
    );
    expect(saved['verification.identity']).toBeUndefined();
  });

  it('does not record a pending step as failed', async () => {
    await post(payload({ nin_check: { status: 'pending' } }));
    expect(saved['verification.identity']).toBeUndefined();
  });

  it('names what failed when the workflow finishes short', async () => {
    // NO_MATCH, not a partial one — only a flat failure ends the run short.
    // Otherwise the vendor sits on "in progress" forever, waiting for a step
    // that already failed.
    await post(
      payload(
        {
          nin_check: { status: 'EXACT_MATCH' },
          cac_check: { status: 'NO_MATCH' },
        },
        'verification_completed',
      ),
    );
    expect(saved.verification_state).toBe('action_required');
    expect(saved.verification_message).toMatch(/CAC registration/i);
    expect(saved.verification_message).toMatch(/contact support/i);
  });

  it('does not flag action required when the workflow finishes clean', async () => {
    await post(
      payload(
        {
          nin_check: { status: 'EXACT_MATCH' },
          cac_check: { status: 'EXACT_MATCH' },
          nuban_check: { status: 'EXACT_MATCH' },
          liveness_check: { status: 'EXACT_MATCH' },
        },
        'verification_completed',
      ),
    );
    expect(saved.verification_state).toBe('provider_complete');
    expect(saved.verification_message).toBeUndefined();
  });

  it('accepts an unmatched reference without asking for a redelivery', async () => {
    // A non-2xx would have QoreID retry something we can never match.
    stored = null;
    const res = await post({
      event: 'workflow',
      data: { customerReference: 'biz_000000000000000000000000_1' },
    });
    expect(res).toEqual({ received: true, matched: false });
  });
});
