import {
  Controller,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';
import {
  Business,
  BusinessDocument,
} from '../business/schemas/business.schema';
import { VerificationState } from '../business/schemas/business.schema';
import { QoreIdService } from './qoreid.service';
import { nextVerificationState } from './verification-state';

/**
 * Event types that carry results.
 *
 * A workflow reports four times over: verification_started and
 * step_verification_started announce that something is beginning and carry no
 * verdict, while the _completed pair carry the outcome. Reading results off a
 * _started event would record every check as failed the moment it began,
 * because a check that has not finished is not a check that passed.
 */
const RESULT_EVENTS = ['verification_completed', 'step_verification_completed'];

/** Statuses that mean "still going", as opposed to a verdict. */
const PENDING_MATCHES = ['pending', 'in_progress', 'processing'];

/** Which stored verdict each workflow step writes to, with doc aliases. */
const CHECK_TARGETS: { field: string; keys: string[]; label: string }[] = [
  {
    field: 'identity',
    keys: ['nin_check', 'vnin_check', 'identity_check', 'liveness_check'],
    label: 'your identity',
  },
  {
    field: 'business',
    keys: ['cac_check', 'business_check', 'cac_basic_check'],
    label: 'your CAC registration',
  },
  {
    field: 'bank',
    keys: ['nuban_check', 'bank_check', 'account_check'],
    label: 'your payout account',
  },
];

/**
 * Results from the hosted workflow.
 *
 * This is the ONLY path a verdict may arrive on. The SDK fires a 'success'
 * event in the browser, but a client reporting its own success is not a
 * verification — anyone can post that. The browser event is for moving the UI
 * along; this is for deciding whether someone may sell.
 */
@ApiTags('Webhook')
@Controller('webhook')
export class QoreIdWebhookController {
  private readonly logger = new Logger(QoreIdWebhookController.name);

  constructor(
    private readonly qoreid: QoreIdService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  @Public()
  @Post('qoreid')
  @ApiOperation({ summary: 'Handle a QoreID verification webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async handle(@Req() req: any) {
    // The signature covers the exact bytes sent; bootstrap captures rawBody.
    const raw: string =
      req.rawBody instanceof Buffer
        ? req.rawBody.toString('utf8')
        : JSON.stringify(req.body ?? {});

    if (
      !this.qoreid.verifyWebhookSignature(
        raw,
        req.headers?.['x-verifyme-signature'],
      )
    ) {
      this.logger.warn('[QoreID] Rejected a webhook with a bad signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const body = req.body ?? {};
    const data = body?.data ?? {};

    // Our reference, set when the session was minted: `biz_<id>_<attempt>`.
    // Identity events do not carry it, per QoreID's own docs, which is why
    // the session id is stored as a fallback route back to the business.
    const reference: string =
      data?.customerReference ?? data?.customer_reference ?? '';
    const sessionId = data?.sessionId ?? data?.session_id ?? null;

    const business = await this.findBusiness(reference, sessionId);
    if (!business) {
      // 200, deliberately: a retry will not help, and a non-2xx invites
      // QoreID to redeliver something we can never match.
      this.logger.warn(
        `[QoreID] No business for reference "${reference}" / session "${sessionId}"`,
      );
      return { received: true, matched: false };
    }

    const summary = data?.summary ?? {};
    const state = data?.status ?? {};
    const eventType: string = body?.event_type ?? '';
    const carriesResults = RESULT_EVENTS.includes(eventType);

    /**
     * Storage-safe summaries only, same rule as the per-check endpoints: a
     * verdict, a provider reference and a verified name. The documents and
     * the selfie stay at QoreID and never reach our storage — which is most
     * of the reason to use the hosted flow at all.
     */
    const verdict = (keys: string[]) => {
      const key = keys.find((k) => summary?.[k]);
      if (!key) return undefined;

      const match = summary[key]?.status ?? null;
      // A step that has not settled yet is not a failure. Recording one would
      // leave a vendor looking at a red cross for a check still running.
      if (!match || PENDING_MATCHES.includes(String(match).toLowerCase())) {
        return undefined;
      }

      const verified = match === 'EXACT_MATCH';
      return {
        status: verified ? 'verified' : 'failed',
        match,
        provider_ref: data?.id ?? null,
        verified_at: verified ? new Date() : null,
      };
    };

    const update: Record<string, any> = {};
    const failures: string[] = [];

    if (carriesResults) {
      for (const target of CHECK_TARGETS) {
        const result = verdict(target.keys);
        if (!result) continue;
        update[`verification.${target.field}`] = result;
        if (result.status !== 'verified') failures.push(target.label);
      }
    }

    update['verification.session'] = {
      ...((business as any).verification?.session ?? {}),
      session_id: sessionId ?? (business as any).verification?.session?.session_id,
      reference: reference || (business as any).verification?.session?.reference,
      last_event: body?.event_type ?? body?.event ?? null,
      provider_state: state?.state ?? null,
      updated_at: new Date(),
    };

    await this.businessModel.updateOne(
      { _id: business._id },
      { $set: update },
    );

    // Re-read so the state is computed from what is actually stored, not from
    // a partial payload: a workflow reports steps as they finish, so one
    // webhook rarely carries every check.
    const fresh = await this.businessModel
      .findById(business._id)
      .select('verification verification_state')
      .lean();

    const next = nextVerificationState(
      (fresh as any)?.verification,
      (fresh as any)?.verification_state,
    );
    if (next) {
      await this.businessModel.updateOne(
        { _id: business._id },
        { $set: { verification_state: next } },
      );
    }

    // The whole workflow finishing is the one moment we know nothing more is
    // coming. If the checks did not all pass, say so now and name them — the
    // alternative is a vendor sitting on "in progress" forever, waiting for a
    // step that already failed.
    //
    // No extra attempt is granted here: a retry costs a billed run, so it
    // stays an admin decision. The message is what makes that decision quick.
    const workflowFinished =
      (body?.event ?? '') === 'workflow' &&
      eventType === 'verification_completed';

    if (workflowFinished && next !== VerificationState.PROVIDER_COMPLETE) {
      const state = (fresh as any)?.verification_state;
      const settled = [
        VerificationState.PROVIDER_COMPLETE,
        VerificationState.AWAITING_REVIEW,
        VerificationState.APPROVED,
        VerificationState.REJECTED,
      ];
      if (!settled.includes(state)) {
        const outstanding = failures.length
          ? failures.join(', ')
          : 'one or more checks';
        await this.businessModel.updateOne(
          { _id: business._id },
          {
            $set: {
              verification_state: VerificationState.ACTION_REQUIRED,
              verification_message:
                `We could not confirm ${outstanding}. ` +
                'Contact support and we will reopen your verification.',
            },
          },
        );
      }
    }

    return { received: true, matched: true };
  }

  /**
   * Find the business a result belongs to.
   *
   * The reference is ours and is the reliable route. The session id is the
   * fallback for events that omit it.
   */
  private async findBusiness(reference: string, sessionId: string | null) {
    if (reference) {
      const match = /^biz_([a-f\d]{24})_/i.exec(reference);
      if (match) {
        const found = await this.businessModel
          .findById(match[1])
          .select('verification verification_state')
          .lean();
        if (found) return found;
      }
      const byReference = await this.businessModel
        .findOne({ 'verification.session.reference': reference })
        .select('verification verification_state')
        .lean();
      if (byReference) return byReference;
    }

    if (sessionId) {
      return this.businessModel
        .findOne({ 'verification.session.session_id': sessionId })
        .select('verification verification_state')
        .lean();
    }

    return null;
  }
}
