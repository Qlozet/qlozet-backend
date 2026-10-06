import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { MailService } from '../notifications/mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AuthProvider,
  User,
  UserType,
} from '../ums/schemas/user.schema';
import { Role } from '../ums/schemas/role.schema';
import { Token } from '../wallets/schema/token.schema';
import { Business } from '../business/schemas/business.schema';
import { Wallet } from '../wallets/schema/wallet.schema';
import { TeamMember } from '../ums/schemas/team.schema';
import { PlatformSettings } from '../platform/schema/platformSettings.schema';

// Google's verifier is the one thing a test cannot exercise for real, so it is
// mocked and the payload it returns is what each case varies.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  })),
}));

const payload = (over: Record<string, unknown> = {}) => ({
  sub: 'google-subject-123',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada Obi',
  picture: 'https://lh3.googleusercontent.com/a/ada',
  ...over,
});

describe('AuthService.loginWithGoogle', () => {
  let service: AuthService;
  let userModel: any;
  let walletModel: any;
  let tokenModel: any;
  let roleModel: any;

  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });

    userModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn().mockImplementation((docs: any[]) => [
        {
          ...docs[0],
          _id: 'new-user-id',
          toObject: () => ({ ...docs[0], _id: 'new-user-id' }),
        },
      ]),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    walletModel = { create: jest.fn().mockResolvedValue([{}]) };
    tokenModel = { create: jest.fn().mockResolvedValue([{}]) };
    roleModel = { findOne: jest.fn().mockResolvedValue({ _id: 'role-id' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Token.name), useValue: tokenModel },
        { provide: getModelToken(Business.name), useValue: {} },
        { provide: getModelToken(Role.name), useValue: roleModel },
        { provide: getModelToken(Wallet.name), useValue: walletModel },
        { provide: getModelToken(TeamMember.name), useValue: {} },
        {
          provide: getModelToken(PlatformSettings.name),
          useValue: {
            findOne: jest
              .fn()
              .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn().mockResolvedValue(session) },
        },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('jwt') } },
        { provide: MailService, useValue: {} },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('a Google account signing up for the first time', () => {
    it('creates the customer without a password or a phone number', async () => {
      await service.loginWithGoogle('token');

      expect(userModel.create).toHaveBeenCalledTimes(1);
      const created = userModel.create.mock.calls[0][0][0];

      expect(created.auth_provider).toBe(AuthProvider.GOOGLE);
      expect(created.type).toBe(UserType.CUSTOMER);
      expect(created.google_id).toBe('google-subject-123');
      // Google has verified the address, so there is no code to send.
      expect(created.email_verified).toBe(true);
      expect(created.hashed_password).toBeUndefined();
      // Google supplies no phone; the delivery number lives on the address.
      expect(created.phone_number).toBeUndefined();
    });

    it('lower-cases the email so it cannot duplicate an existing account', async () => {
      await service.loginWithGoogle('token');
      expect(userModel.create.mock.calls[0][0][0].email).toBe('ada@example.com');
    });

    it('gives the new customer a wallet, in the same transaction', async () => {
      await service.loginWithGoogle('token');

      expect(walletModel.create).toHaveBeenCalledTimes(1);
      expect(tokenModel.create).toHaveBeenCalledTimes(1);
      expect(session.commitTransaction).toHaveBeenCalledTimes(1);
      expect(session.abortTransaction).not.toHaveBeenCalled();
    });

    it('returns a token, so signing up signs you in', async () => {
      const result = await service.loginWithGoogle('token');
      expect(result.data.token).toBeDefined();
    });

    it('does not leak google_id back to the client', async () => {
      const result = await service.loginWithGoogle('token');
      expect((result.data.user as Record<string, unknown>).google_id).toBeUndefined();
    });
  });

  describe('refusals', () => {
    it('rejects a Google account whose email is unverified', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => payload({ email_verified: false }),
      });

      await expect(service.loginWithGoogle('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('rejects a token Google will not verify', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('bad signature'));

      await expect(service.loginWithGoogle('token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('pins the audience to our client id when verifying', async () => {
      await service.loginWithGoogle('token');
      expect(mockVerifyIdToken).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: 'test-client-id.apps.googleusercontent.com',
        }),
      );
    });

    it('refuses a business account rather than converting it', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'vendor-id',
          email: 'ada@example.com',
          type: UserType.VENDOR,
          status: 'active',
          toObject: () => ({}),
        }),
      });

      await expect(service.loginWithGoogle('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('an existing password account', () => {
    it('links to Google without creating a second account', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'existing-id',
          email: 'ada@example.com',
          type: UserType.CUSTOMER,
          status: 'active',
          email_verified: false,
          google_id: undefined,
          toObject: () => ({ _id: 'existing-id', email: 'ada@example.com' }),
        }),
      });

      const result = await service.loginWithGoogle('token');

      expect(userModel.create).not.toHaveBeenCalled();
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'existing-id' },
        expect.objectContaining({
          $set: expect.objectContaining({
            google_id: 'google-subject-123',
            // A verified Google email is proof enough to mark the account
            // verified, which is what makes the link safe.
            email_verified: true,
          }),
        }),
      );
      expect(result.data.token).toBeDefined();
    });
  });
});
