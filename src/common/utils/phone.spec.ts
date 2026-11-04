import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { normalizePhone } from './phone';
import { VendorRegisterDto } from '../../modules/auth/dto/vendor-register.dto';

describe('phone numbers on sign-up', () => {
  it('stores one spelling per number', () => {
    expect(normalizePhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalizePhone('+23408031234567')).toBe('+2348031234567');
    expect(normalizePhone(' +234 (0)803-123-4567 ')).toBe('+2348031234567');
  });

  it('leaves a bad number for the validator to refuse', () => {
    expect(normalizePhone('+234803')).toBe('+234803');
    expect(normalizePhone(undefined)).toBeUndefined();
  });

  const dto = (phone: string) =>
    plainToInstance(VendorRegisterDto, {
      business_name: 'Ada Couture',
      personal_name: 'Ada Obi',
      personal_email: 'ada@example.com',
      personal_phone_number: phone,
      password: 'ShopPass1',
    });

  it('the vendor sign-up accepts a spaced number and saves it plainly', async () => {
    const d = dto('+234 803 123 4567');
    expect(await validate(d)).toHaveLength(0);
    expect(d.personal_phone_number).toBe('+2348031234567');
  });

  it('refuses a short number in words a person can act on', async () => {
    const errors = await validate(dto('+234803123456'));
    const msg = Object.values(errors[0].constraints ?? {})[0];
    expect(msg).toMatch(/valid phone number with its country code/);
    expect(msg).not.toMatch(/personal_phone_number/);
  });
});
