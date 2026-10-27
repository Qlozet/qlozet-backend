import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * Signing in to an account whose email isn't verified: the right password
 * gets a fresh code and a message saying so; a wrong password reveals
 * nothing and sends nothing.
 */
describe('sign-in before the email is verified', () => {
  const hashed = bcrypt.hashSync('right-password', 4);

  const build = (type: 'vendor' | 'customer') => {
    const user: any = {
      _id: new Types.ObjectId(),
      email: 'ada@example.com',
      type,
      status: 'active',
      email_verified: false,
      hashed_password: hashed,
    };
    const query: any = {
      select: () => query,
      exec: async () => user,
      then: (res: any, rej: any) => Promise.resolve(user).then(res, rej),
    };
    const service = Object.create(AuthService.prototype) as any;
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.userModel = { findOne: jest.fn(() => query) };
    service.resendVerificationEmail = jest.fn(async () => ({ message: 'sent' }));
    const login = (password: string) =>
      type === 'vendor'
        ? service.loginVendor(user.email, password)
        : service.loginCustomer(user.email, password);
    return { service, login };
  };

  for (const type of ['vendor', 'customer'] as const) {
    describe(type, () => {
      it('sends a new code when the password is right', async () => {
        const { service, login } = build(type);
        await expect(login('right-password')).rejects.toThrow(
          /verify your email\. We've sent a new code/,
        );
        expect(service.resendVerificationEmail).toHaveBeenCalledWith('ada@example.com');
      });

      it('sends nothing and says nothing about verification on a wrong password', async () => {
        const { service, login } = build(type);
        await expect(login('wrong')).rejects.toThrow('Invalid credentials');
        expect(service.resendVerificationEmail).not.toHaveBeenCalled();
      });

      it('says a code went out moments ago when the one-a-minute limit applies', async () => {
        const { service, login } = build(type);
        service.resendVerificationEmail.mockRejectedValueOnce(
          new BadRequestException('Please wait 40 seconds'),
        );
        await expect(login('right-password')).rejects.toThrow(/less than a minute ago/);
      });

      it('says so when the email could not be sent', async () => {
        const { service, login } = build(type);
        service.resendVerificationEmail.mockRejectedValueOnce(
          new ServiceUnavailableException('smtp down'),
        );
        const err = await login('right-password').catch((e: any) => e);
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.message).toMatch(/verify your email.*couldn't send/);
      });
    });
  }
});
