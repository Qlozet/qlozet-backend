import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserType } from '../ums/schemas/user.schema';
import { Business, BusinessDocument } from '../business/schemas/business.schema';
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
@Roles(UserType.VENDOR)
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly qoreid: QoreIdService,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current verification state for my business' })
  async state(@Req() req: any) {
    const business = await this.businessModel
      .findById(req.business.id)
      .select('verification status business_name')
      .lean();
    return {
      configured: this.qoreid.isConfigured(),
      status: (business as any)?.status ?? 'pending',
      verification: (business as any)?.verification ?? {},
    };
  }

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

    // A clean identity pass earns the Verified badge automatically —
    // unless an admin has explicitly rejected the business.
    if (verdict.verified) {
      await this.businessModel.updateOne(
        { _id: req.business.id, status: { $ne: 'rejected' } },
        { $set: { status: 'verified' } },
      );
    }

    return { verified: verdict.verified, identity };
  }

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
    return { verified: result.verified, business: businessBlock };
  }

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
    return { verified: result.verified, bank };
  }
}
