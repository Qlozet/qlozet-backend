import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { AdminUpdateBusinessDto } from './dto/admin-update-business.dto';
import { BusinessService } from '../business/business.service';

const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(AdminUpdateBusinessDto, body);
  const errors = await validate(dto, { whitelist: false });
  return errors.map((e) => e.property);
};

describe('AdminUpdateBusinessDto — compliance documents', () => {
  // These two were absent from the allowlist, so an admin could read a
  // vendor's CAC certificate but never attach one.
  it('accepts a CAC document list and an SVG logo', async () => {
    expect(
      await errorsFor({
        cac_document_url: ['https://res.cloudinary.com/x/upload/cac.pdf'],
        business_logo_svg_url: 'https://res.cloudinary.com/x/upload/logo.svg',
      }),
    ).toEqual([]);
  });

  it('rejects a bare string where the record stores a list', async () => {
    expect(
      await errorsFor({ cac_document_url: 'https://res.cloudinary.com/x.pdf' }),
    ).toContain('cac_document_url');
  });

  it('rejects a malformed entry inside the list', async () => {
    // `require_tld: false` is deliberately lenient — it has to accept internal
    // and localhost hosts — so a bare word passes. Whitespace does not.
    expect(await errorsFor({ cac_document_url: ['not a url'] })).toContain(
      'cac_document_url',
    );
  });

  it('strips the money and lifecycle fields before they reach $set', async () => {
    // The DTO is an allowlist only because this pipe whitelists. Without it
    // the extra keys survive and updateBusinessProfile $sets them verbatim.
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const cleaned = await pipe.transform(
      {
        business_name: 'Fashion Store Ltd',
        status: 'verified',
        earnings: 10_000,
        transfer_recipient_code: 'RCP_x',
      },
      { type: 'body', metatype: AdminUpdateBusinessDto },
    );

    expect({ ...cleaned }).toEqual({ business_name: 'Fashion Store Ltd' });
  });
});

describe('updateBusinessProfile', () => {
  it('writes the document fields through to the record', async () => {
    const findByIdAndUpdate = jest.fn().mockResolvedValue({ _id: 'b1' });
    const service = Object.create(
      BusinessService.prototype,
    ) as BusinessService;
    (service as unknown as { businessModel: unknown }).businessModel = {
      findByIdAndUpdate,
    };

    const id = new Types.ObjectId().toString();
    await service.updateBusinessProfile(id, {
      cac_document_url: ['https://cdn/cac.pdf'],
      business_logo_svg_url: 'https://cdn/logo.svg',
    });

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      id,
      {
        $set: {
          cac_document_url: ['https://cdn/cac.pdf'],
          business_logo_svg_url: 'https://cdn/logo.svg',
        },
      },
      { new: true },
    );
  });
});
