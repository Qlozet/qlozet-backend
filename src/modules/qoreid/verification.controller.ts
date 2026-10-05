import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { VendorRoles } from '../../common/decorators/vendor-roles.decorator';
import { VendorRole } from '../ums/schemas/role.schema';
import { UserType } from '../ums/schemas/user.schema';
import {
  Business,
  BusinessDocument,
  BusinessStatus,
  VerificationState,
} from '../business/schemas/business.schema';
import {
  SERVICE_AGREEMENT,
  hasAcceptedCurrentAgreement,
} from '../business/service-agreement';
import { getVendorAgreement } from '../business/agreements';
import { nextVerificationState } from './verification-state';
import { QoreIdService } from './qoreid.service';

class VerifyVninDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{16}$/, {
    message:
      'A virtual NIN is 16 characters — generate one with *346*3*YourNIN*AgentCode# or the NIMC app.',
  })
  vnin: string;

  // NIMC name can differ from the account name — the form lets the vendor
  // correct it, defaulting to their registered name.
  @IsOptional()
  @IsString()
  firstname?: string;

  @IsOptional()
  @IsString()
  lastname?: string;
}

class VerifyCacDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter your CAC registration (RC/BN) number.' })
  rc_number: string;
}

class AcceptAgreementDto {
  @IsString()
  @IsNotEmpty({ message: 'Which version are you accepting?' })
  version: string;
}

class CacDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Upload the document first, then save it here.' })
  @Matches(/^https:\/\//, { message: 'A document URL must be https.' })
  document_url: string;
}

class VerifyBankDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'A NUBAN account number is 10 digits.' })
  account_number: string;

  @IsString()
  @IsNotEmpty({ message: 'Pick your bank.' })
  bank_code: string;

  @IsOptional()
  @IsString()
  bank_name?: string;
}

const maskId = (value: string) => `***${value.slice(-4)}`;

/** Split a full name into the first/last pair identity sources expect. */
const splitName = (full: string | undefined | null) => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    firstname: parts[0] ?? '',
    lastname: parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? ''),
  };
};

@ApiTags('Verification')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly qoreid: QoreIdService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  /**
   * Move the verification state to match the checks that have passed.
   *
   * Called after every check, so the vendor's dashboard reflects reality
   * without a separate "I'm done" step they could forget. The rule itself
   * lives in nextVerificationState, shared with the workflow webhook so the
   * two routes into verification cannot disagree about what "done" means.
   */
  private async refreshVerificationState(businessId: string): Promise<void> {
    const business = await this.businessModel
      .findById(businessId)
      .select('verification verification_state')
      .lean();
    if (!business) return;

    const next = nextVerificationState(
      (business as any).verification,
      (business as any).verification_state,
    );
    if (!next) return;

    await this.businessModel.updateOne(
      { _id: businessId },
      { $set: { verification_state: next } },
    );
  }

  // Handler-level: the RolesGuard reads roles from the handler, not the class.
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Get()
  @ApiOperation({ summary: 'Current verification state for my business' })
  async state(@Req() req: any) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select(
        'verification status business_name verification_state ' +
          'verification_message verification_attempts ' +
          'verification_attempts_allowed service_agreement',
      )
      .lean();

    const b = business as any;
    const agreementAccepted = hasAcceptedCurrentAgreement(b ?? {});
    const state = b?.verification_state ?? VerificationState.NOT_STARTED;

    return {
      configured: this.qoreid.isConfigured(),
      /**
       * Whether the hosted workflow is available. False until
       * QOREID_WORKFLOW_ID is set, which is what lets the console ship ahead
       * of the configuration: no workflow, and the vendor sees the older
       * per-check cards, which still work.
       */
      workflow_available:
        this.qoreid.isConfigured() && this.qoreid.workflowId !== null,
      status: b?.status ?? 'pending',
      verification: b?.verification ?? {},
      /** Where they are, and what to do next. */
      verification_state: state,
      verification_message: b?.verification_message ?? null,
      /**
       * Whether they may start (or retry) a provider run. Each run costs real
       * money, so the allowance is explicit rather than implied by the state.
       */
      attempts_used: b?.verification_attempts ?? 0,
      attempts_allowed: b?.verification_attempts_allowed ?? 1,
      can_start:
        agreementAccepted &&
        (b?.verification_attempts ?? 0) < (b?.verification_attempts_allowed ?? 1) &&
        ![
          VerificationState.AWAITING_REVIEW,
          VerificationState.APPROVED,
          VerificationState.REJECTED,
        ].includes(state),
      service_agreement: {
        required_version: SERVICE_AGREEMENT.VERSION,
        /** Fetch the text from GET /verification/service-agreement. */
        accepted: agreementAccepted,
        accepted_at: b?.service_agreement?.accepted_at ?? null,
        /** True when they signed an older version and must sign again. */
        outdated: Boolean(b?.service_agreement) && !agreementAccepted,
      },
    };
  }

  // Handler-level: the RolesGuard reads roles from the handler, not the class.
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('identity/vnin')
  @ApiOperation({ summary: 'Verify my identity with a virtual NIN (vNIN)' })
  async verifyVnin(@Req() req: any, @Body() dto: VerifyVninDto) {
    const fallback = splitName(req.user?.full_name);
    const firstname = (dto.firstname ?? '').trim() || fallback.firstname;
    const lastname = (dto.lastname ?? '').trim() || fallback.lastname;
    if (!firstname || !lastname) {
      throw new BadRequestException(
        'Enter the first and last name on your NIN record.',
      );
    }

    const verdict = await this.qoreid.verifyVnin(
      dto.vnin,
      firstname,
      lastname,
    );

    // Storage-safe record: verdict + masked id only — never the vNIN itself.
    const identity = {
      status: verdict.verified ? 'verified' : 'failed',
      id_type: 'vnin',
      provider_ref: verdict.provider_ref,
      verified_name:
        verdict.verified_name || `${firstname} ${lastname}`.trim(),
      masked_id: maskId(dto.vnin),
      match: verdict.match,
      verified_at: verdict.verified ? new Date() : null,
    };

    const update: Record<string, any> = { 'verification.identity': identity };
    await this.businessModel.updateOne({ _id: req.business.id }, { $set: update });

    // A clean identity pass does NOT make a vendor sellable. It used to set
    // status: 'verified' here, which meant passing one check - no bank
    // account, no CAC, no human review - put a vendor straight into the
    // catalogue with the Verified badge. Trading status is now only ever
    // moved by an admin decision; this check just advances the state machine.
    await this.refreshVerificationState(req.business.id);

    return { verified: verdict.verified, identity };
  }

  // Handler-level: the RolesGuard reads roles from the handler, not the class.
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('business/cac')
  @ApiOperation({ summary: 'Verify my CAC registration (Registered Business badge)' })
  async verifyCac(@Req() req: any, @Body() dto: VerifyCacDto) {
    const result = await this.qoreid.verifyCacBasic(dto.rc_number);

    // The RC number is public registry data — safe (and useful) to keep.
    const businessBlock = {
      status: result.verified ? 'verified' : 'failed',
      provider_ref: result.provider_ref,
      rc_number: dto.rc_number.trim(),
      company_name: result.company_name,
      verified_at: result.verified ? new Date() : null,
    };
    await this.businessModel.updateOne(
      { _id: req.business.id },
      { $set: { 'verification.business': businessBlock } },
    );
    await this.refreshVerificationState(req.business.id);
    return { verified: result.verified, business: businessBlock };
  }

  /**
   * Start a hosted verification run.
   *
   * Mints a QoreID session against the published workflow and hands back the
   * short-lived SDK token. The vendor completes liveness, identity document,
   * CAC and NUBAN inside QoreID's flow; results arrive on the webhook, never
   * from the browser, because a client that reports its own success is not a
   * verification.
   *
   * Guarded on three things, in this order, because each run is billed:
   * the agreement must be signed, an attempt must be available, and the
   * business must not already be in a state an admin owns.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('session')
  @ApiOperation({ summary: 'Start a verification run (hosted QoreID flow)' })
  async startSession(@Req() req: any) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select(
        'verification_state verification_attempts ' +
          'verification_attempts_allowed service_agreement',
      )
      .lean();
    if (!business) throw new BadRequestException('Business not found');

    const b = business as any;

    if (!hasAcceptedCurrentAgreement(b)) {
      throw new BadRequestException(
        'Accept the vendor service agreement before starting verification.',
      );
    }

    const state = b.verification_state;
    if (state === VerificationState.AWAITING_REVIEW) {
      throw new BadRequestException(
        'Your business is already under review — nothing to do right now.',
      );
    }
    if (state === VerificationState.APPROVED) {
      throw new BadRequestException('Your business is already verified.');
    }
    if (state === VerificationState.REJECTED) {
      throw new BadRequestException(
        'This business was rejected. Contact support to reopen it.',
      );
    }

    const used = b.verification_attempts ?? 0;
    const allowed = b.verification_attempts_allowed ?? 1;
    if (used >= allowed) {
      throw new BadRequestException(
        'You have used your verification attempt. Contact support if you ' +
          'need another.',
      );
    }

    // Ours, unique per attempt, and what the webhook quotes back — it is how
    // a result is matched to a business.
    const reference = `biz_${req.business.id}_${used + 1}`;
    const session = await this.qoreid.createWorkflowSession(reference);

    // Minting does NOT spend the attempt. QoreID bills for the checks it
    // performs, and a session nobody uses performs none — so a vendor who
    // opens the flow, sees what it asks for and closes it has cost nothing
    // and must not be locked out. The attempt is counted when the workflow
    // actually starts, which the webhook reports.
    await this.businessModel.updateOne(
      { _id: req.business.id },
      {
        $set: {
          verification_state: VerificationState.IN_PROGRESS,
          verification_message: null,
          'verification.session': {
            session_id: session.session_id,
            reference,
            started_at: new Date(),
          },
        },
      },
    );

    return {
      session_id: session.session_id,
      // The browser gets the token and nothing else.
      sdk_token: session.sdk_token,
      expires_at: session.expires_at,
      reference,
    };
  }

  /**
   * The agreement text.
   *
   * Served rather than linked so that the words and the version can never
   * drift apart: the vendor reads the exact text their acceptance record will
   * name. An older version can still be fetched by passing ?version=, which
   * is what makes the record worth keeping.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Get('service-agreement')
  @ApiOperation({ summary: 'The vendor service agreement text' })
  async serviceAgreement(@Query('version') version?: string) {
    const wanted = version?.trim() || SERVICE_AGREEMENT.VERSION;
    const body = getVendorAgreement(wanted);

    if (!body) {
      throw new BadRequestException(`No agreement published for "${wanted}".`);
    }

    return {
      version: wanted,
      /** True when this is the version a vendor must accept today. */
      current: wanted === SERVICE_AGREEMENT.VERSION,
      body,
    };
  }

  /**
   * Accept the service agreement.
   *
   * The version is sent by the client and must match the one in force: that
   * way a vendor cannot accept a page they were shown before the terms
   * changed, and a stale tab fails loudly instead of recording consent to text
   * nobody displayed.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('service-agreement')
  @ApiOperation({ summary: 'Accept the vendor service agreement' })
  async acceptAgreement(@Req() req: any, @Body() dto: AcceptAgreementDto) {
    if (dto.version !== SERVICE_AGREEMENT.VERSION) {
      throw new BadRequestException(
        'The agreement has been updated since this page loaded. Reload and ' +
          'read the current version before accepting.',
      );
    }

    const accepted = {
      version: SERVICE_AGREEMENT.VERSION,
      accepted_at: new Date(),
      accepted_by: req.user?.id ?? req.user?._id ?? null,
      // Behind a proxy the first X-Forwarded-For entry is the client.
      ip:
        (req.headers?.['x-forwarded-for'] ?? '').toString().split(',')[0].trim() ||
        req.ip ||
        null,
    };

    await this.businessModel.updateOne(
      { _id: req.business.id },
      { $set: { service_agreement: accepted } },
    );

    return { message: 'Agreement accepted', service_agreement: accepted };
  }

  /**
   * Submit for review once the provider checks are done.
   *
   * Two preconditions, and both exist to stop a vendor waiting on a queue they
   * were never actually in: the agreement must be signed, and the provider
   * must have returned something to review.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('submit')
  @ApiOperation({ summary: 'Submit my business for review' })
  async submitForReview(@Req() req: any) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select('verification_state service_agreement')
      .lean();

    if (!business) throw new BadRequestException('Business not found');

    if (!hasAcceptedCurrentAgreement(business as any)) {
      throw new BadRequestException(
        'Accept the vendor service agreement before submitting.',
      );
    }

    const state = (business as any).verification_state;
    if (state === VerificationState.AWAITING_REVIEW) {
      throw new BadRequestException('Your business is already under review.');
    }
    if (state === VerificationState.APPROVED) {
      throw new BadRequestException('Your business is already approved.');
    }
    if (state !== VerificationState.PROVIDER_COMPLETE) {
      throw new BadRequestException(
        'Finish the identity checks before submitting for review.',
      );
    }

    await this.businessModel.updateOne(
      { _id: req.business.id },
      {
        $set: {
          verification_state: VerificationState.AWAITING_REVIEW,
          verification_submitted_at: new Date(),
          verification_message: null,
          // Trading status follows: in-review is visible to the admin queue
          // and still not sellable, which is the correct reading.
          status: BusinessStatus.IN_REVIEW,
        },
      },
    );

    return {
      message: 'Submitted for review',
      verification_state: VerificationState.AWAITING_REVIEW,
    };
  }

  /**
   * File the CAC certificate as supporting evidence.
   *
   * Separate from the RC-number check above, and deliberately not dependent
   * on it: the document exists precisely for the cases the automated check
   * cannot settle - a lookup that fails, a name that does not match, a
   * dispute where an admin needs to see the certificate itself. Tying it to a
   * successful verification would remove it exactly when it is needed.
   *
   * This is the only way the document reaches a business record now. It used
   * to arrive through the generic profile PATCH and through registration,
   * which put a legal document on the same footing as a logo.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('business/cac/document')
  @ApiOperation({ summary: 'File my CAC certificate as supporting evidence' })
  async fileCacDocument(@Req() req: any, @Body() dto: CacDocumentDto) {
    const url = dto.document_url.trim();

    // $addToSet, not $push: re-saving the same upload should not grow the
    // list. The newest entry is the one both consoles display.
    await this.businessModel.updateOne(
      { _id: req.business.id },
      { $addToSet: { cac_document_url: url } },
    );

    const business = await this.businessModel
      .findById(req.business.id)
      .select('cac_document_url')
      .lean();

    return {
      message: 'Document filed',
      cac_document_url: business?.cac_document_url ?? [url],
    };
  }

  /**
   * Verify the ALREADY-LINKED payout account (Settings → Payout) against the
   * vendor's verified identity — the seamless path: no re-typing account
   * details, one source of truth for the bank account.
   */
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('bank/payout')
  @ApiOperation({ summary: 'Verify my linked payout account matches my identity' })
  async verifyPayoutBank(@Req() req: any) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select(
        'verification payout_account_number payout_bank_code payout_bank_name',
      )
      .lean();
    const accountNumber = (business as any)?.payout_account_number;
    const bankCode = (business as any)?.payout_bank_code;
    if (!accountNumber || !bankCode) {
      throw new BadRequestException(
        'Link a payout account under Settings → Payout first.',
      );
    }
    const source =
      (business as any)?.verification?.identity?.verified_name ||
      req.user?.full_name;
    const { firstname, lastname } = splitName(source);
    const result = await this.qoreid.verifyNuban(
      accountNumber,
      bankCode,
      firstname,
      lastname,
    );
    const bank = {
      status: result.verified ? 'verified' : 'failed',
      provider_ref: result.provider_ref,
      account_number: accountNumber,
      bank_code: bankCode,
      bank_name: (business as any)?.payout_bank_name ?? null,
      account_name: result.account_name,
      name_match: result.match,
      verified_at: result.verified ? new Date() : null,
    };
    await this.businessModel.updateOne(
      { _id: req.business.id },
      { $set: { 'verification.bank': bank } },
    );
    await this.refreshVerificationState(req.business.id);
    return { verified: result.verified, bank };
  }

  // Handler-level: the RolesGuard reads roles from the handler, not the class.
  @Roles(UserType.VENDOR)
  @VendorRoles(VendorRole.OWNER)
  @Post('bank')
  @ApiOperation({ summary: 'Verify my payout bank account (NUBAN)' })
  async verifyBank(@Req() req: any, @Body() dto: VerifyBankDto) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select('verification')
      .lean();
    // Match the account against the identity-verified name when we have it,
    // falling back to the owner's registered name.
    const source =
      (business as any)?.verification?.identity?.verified_name ||
      req.user?.full_name;
    const { firstname, lastname } = splitName(source);

    const result = await this.qoreid.verifyNuban(
      dto.account_number,
      dto.bank_code,
      firstname,
      lastname,
    );

    // Account details are operational (payouts need them) — stored in full,
    // unlike identity numbers.
    const bank = {
      status: result.verified ? 'verified' : 'failed',
      provider_ref: result.provider_ref,
      account_number: dto.account_number,
      bank_code: dto.bank_code,
      bank_name: dto.bank_name ?? null,
      account_name: result.account_name,
      name_match: result.match,
      verified_at: result.verified ? new Date() : null,
    };
    await this.businessModel.updateOne(
      { _id: req.business.id },
      { $set: { 'verification.bank': bank } },
    );
    await this.refreshVerificationState(req.business.id);
    return { verified: result.verified, bank };
  }
}
