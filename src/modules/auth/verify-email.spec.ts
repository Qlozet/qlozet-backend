import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { createHash, generateOtp } from '../../common/utils/generateString';

/**
 * Email verification: the newest code always works, a code is checked
 * against the one account it was sent to, wrong guesses are capped, and a
 * mail failure is reported instead of "sent".
 */
describe('email verification codes', () => {
  const session: any = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(async () => undefined),
    abortTransaction: jest.fn(async () => undefined),
    endSession: jest.fn(async () => undefined),
    inTransaction: jest.fn(() => false),
  };

  const makeUser = (over: Record<string, any> = {}) => {
    const user: any = {
      _id: new Types.ObjectId(),
      email: 'ada@example.com',
      full_name: 'Ada',
      type: 'vendor',
      email_verified: false,
      email_verification_token: createHash('123456'),
      email_verification_expires: new Date(Date.now() + 10 * 60 * 1000),
      email_verification_attempts: 0,
      last_verification_email_sent: new Date(Date.now() - 5 * 60 * 1000),
      save: jest.fn(async () => user),
      toObject() {
        return { ...this };
      },
      ...over,
    };
    return user;
  };

  const build = (user: any, mailFails = false) => {
    const updates: any[] = [];
    const sent: any[] = [];
    const service = Object.create(AuthService.prototype) as any;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.connection = { startSession: async () => session };
    service.userModel = {
      findOne: jest.fn(() => ({ select: async () => user })),
      updateOne: jest.fn(async (_q: any, u: any) => updates.push(u)),
      findByIdAndUpdate: jest.fn(async () => undefined),
    };
    service.mailService = {
      sendVerificationEmail: jest.fn(async (...args: any[]) => {
        if (mailFails) throw new Error('SMTP 535 auth failed');
        sent.push(args);
      }),
    };
    service.generateToken = jest.fn(async () => ({ access_token: 'a', refresh_token: 'r' }));
    service.sendWelcomeEmail = jest.fn(async () => undefined);
    return { service, updates, sent };
  };

  it('makes six-digit codes from a secure random source', () => {
    for (let i = 0; i < 50; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('needs the email with a six-digit code', async () => {
    const { service } = build(makeUser());
    await expect(service.verifyEmail('123456')).rejects.toThrow(/email address the code was sent to/);
  });

  it('verifies the right code for that email', async () => {
    const user = makeUser();
    const { service } = build(user);
    const res = await service.verifyEmail('123456', 'Ada@Example.com');
    expect(user.email_verified).toBe(true);
    expect(res.data.token.access_token).toBe('a');
  });

  it('counts a wrong code and says how many tries are left', async () => {
    const { service, updates } = build(makeUser({ email_verification_attempts: 2 }));
    await expect(service.verifyEmail('654321', 'ada@example.com')).rejects.toThrow(/2 tries left/);
    expect(updates[0]).toEqual({ $inc: { email_verification_attempts: 1 } });
  });

  it('stops after five wrong codes', async () => {
    const { service } = build(makeUser({ email_verification_attempts: 5 }));
    await expect(service.verifyEmail('123456', 'ada@example.com')).rejects.toThrow(/Request a new one/);
  });

  it('refuses an expired code', async () => {
    const { service } = build(makeUser({ email_verification_expires: new Date(Date.now() - 1000) }));
    await expect(service.verifyEmail('123456', 'ada@example.com')).rejects.toThrow(/expired/);
  });

  it('a resend stores the code it emails, so the newest code works', async () => {
    const user = makeUser();
    const { service, sent } = build(user);
    await service.resendVerificationEmail('ada@example.com');
    const emailedCode = sent[0][3];
    expect(user.email_verification_token).toBe(createHash(emailedCode));
    expect(user.email_verification_attempts).toBe(0);
    expect(user.email_verification_expires.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);
    // The email's button opens the vendor app's code screen.
    expect(sent[0][2]).toContain('/auth/verification?email=ada%40example.com');
  });

  it('allows one resend a minute', async () => {
    const { service } = build(makeUser({ last_verification_email_sent: new Date(Date.now() - 20 * 1000) }));
    await expect(service.resendVerificationEmail('ada@example.com')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says so when the email could not be sent', async () => {
    const { service } = build(makeUser(), true);
    await expect(service.resendVerificationEmail('ada@example.com')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
