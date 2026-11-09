import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { randomBytes } from 'crypto';
import { ObjectIdUtils } from '../../common/utils/objectId.utils';
import {
  UserDocument,
  User,
  UserType,
  Role,
  RoleDocument,
} from '../ums/schemas';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { CustomerRegistrationDto, VendorRegisterDto } from './dto';
import { JwtService } from '@nestjs/jwt';
import { UserRole, VendorRole } from '../ums/schemas/role.schema';
import { AuthProvider } from '../ums/schemas/user.schema';
import { JwtPayload, Tokens } from 'src/common/types';
import { MailService } from '../notifications/mail/mail.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TeamMember, TeamMemberDocument } from '../ums/schemas/team.schema';
import {
  sanitizeBusiness,
  sanitizeUser,
} from '../../common/utils/sanitization';
import { Wallet, WalletDocument } from '../wallets/schema/wallet.schema';
import {
  BusinessDocument,
  Business,
} from '../business/schemas/business.schema';
import { Token, TokenDocument } from '../wallets/schema/token.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { createHash, generateOtp } from 'src/common/utils/generateString';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';
import { LINKABLE_TYPES } from './linked-accounts';

/** A verification code works for 30 minutes. */
const VERIFY_CODE_TTL_MS = 30 * 60 * 1000;
/** Wrong codes before a new one must be requested. */
const MAX_VERIFY_ATTEMPTS = 5;
/** At most one verification email a minute (the apps count down 90 s). */
const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Token.name) private readonly tokenModel: Model<TokenDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Wallet.name)
    private readonly walletModel: Model<WalletDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Register a new vendor.
   *
   * The same email and number may already hold a SHOPPING account (see
   * linked-accounts.ts). Signing up with that email and the shop password
   * proves it is the same person: the store is ready at once and they are
   * signed in, no code. A different password is refused with a way forward,
   * because one email shares one password. A Google-only shopper (no
   * password) goes through the usual emailed code.
   */
  async registerVendor(data: VendorRegisterDto) {
    const {
      personal_name,
      personal_phone_number,
      personal_email,
      business_name,
      business_email,
      business_phone_number,
      password,
      display_picture_url,
      business_logo_url,
      cover_image_url,
      ...businessData
    } = data;

    await this.assertBusinessContactsFree(
      business_email,
      business_phone_number,
    );

    const sameEmail = await this.userModel
      .find({ email: personal_email })
      .select('+hashed_password');
    if (sameEmail.some((u) => u.type === UserType.PLATFORM)) {
      throw new ConflictException('A user with this email already exists.');
    }
    const existingVendor = sameEmail.find((u) => u.type === UserType.VENDOR);
    if (existingVendor) {
      // An abandoned signup (registered, never entered the code) should be
      // guided back to verification, not dead-ended on "already exists".
      if (!existingVendor.email_verified) {
        await this.resendVerificationEmail(
          existingVendor.email,
          UserType.VENDOR,
        ).catch(() => {});
        throw new ConflictException(
          "This account already exists but isn't verified — we've sent a new code to your email.",
        );
      }
      // Already has a store login (a team member, or an owner opening a
      // second store): the same password adds a store they own to it.
      return this.addStoreToLogin(existingVendor, password, {
        business_name,
        business_email,
        business_phone_number,
        business_logo_url,
        cover_image_url,
        personal_phone_number,
        ...businessData,
      });
    }

    await this.releasePhoneFromUnverified(
      personal_phone_number,
      UserType.VENDOR,
    );
    if (await this.phoneTaken(personal_phone_number, UserType.VENDOR)) {
      throw new ConflictException(
        'A store account with this phone number already exists. Sign in instead, or use a different number.',
      );
    }

    // Already shops on Qlozet with this email?
    const shopper = sameEmail.find((u) => u.type === UserType.CUSTOMER);
    let linked = false;
    if (shopper?.hashed_password) {
      const same = await bcrypt.compare(password, shopper.hashed_password);
      if (!same) {
        throw new ConflictException(
          'You already shop on Qlozet with this email. Use your shop password to open your store, or reset it with Forgot password.',
        );
      }
      // Proven by the password; the email was proven when the shop account
      // was verified. An unverified shop account still gets a code.
      linked = shopper.email_verified === true;
    }

    const hashed_password = await bcrypt.hash(password, 10);
    const otp = linked ? null : generateOtp();

    const { user: vendorUser, business } = await this.createStoreAccount({
      full_name: personal_name,
      email: personal_email,
      phone_number: personal_phone_number,
      hashed_password,
      email_verified: linked,
      verification_code: otp,
      display_picture_url,
      business: {
        business_name,
        business_email,
        business_phone_number,
        business_logo_url,
        cover_image_url,
        ...businessData,
      },
    });

    if (otp) await this.sendVerificationEmail(vendorUser, otp);
    this.notifyNewVendor(business);

    if (linked) {
      this.sendWelcomeEmail(vendorUser, business).catch(() => {});
      const token = await this.issueSession(vendorUser);
      return {
        data: {
          user: sanitizeUser(vendorUser),
          business: sanitizeBusiness(business),
          token,
          linked_shop_account: true,
        },
        message:
          'Your store is ready. Use the same email and password for the shop and your store.',
      };
    }

    return {
      data: {
        user: sanitizeUser(vendorUser),
        business: sanitizeBusiness(business),
      },
      message: 'Vendor registered successfully. Check email to verify.',
    };
  }

  /**
   * Open a store from a signed-in shopping account. Same email, number and
   * password; nothing to verify, the shop account already proved the email.
   * A Google-only shopper has no password, so sets one here for the store.
   */
  async openStoreForCustomer(
    userId: string,
    dto: { business_name: string; password?: string; phone_number?: string },
  ) {
    const shopper = await this.userModel
      .findById(userId)
      .select('+hashed_password');
    if (!shopper || shopper.type !== UserType.CUSTOMER) {
      throw new BadRequestException(
        'Sign in with your shopping account first.',
      );
    }
    if (!shopper.email_verified) {
      throw new BadRequestException(
        'Verify your email before opening a store.',
      );
    }
    const name = String(dto.business_name ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException(
        'Enter your store name (at least 2 characters).',
      );
    }

    const existing = await this.userModel.findOne({
      email: shopper.email,
      type: UserType.VENDOR,
    });
    if (existing) {
      throw new ConflictException(
        'You already have a store account. Sign in to it with this email and your password.',
      );
    }

    let hashed_password = shopper.hashed_password;
    if (!hashed_password) {
      const pw = String(dto.password ?? '');
      if (pw.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(pw)) {
        throw new BadRequestException(
          'Set a password for your store: at least 8 characters, with an uppercase letter, a lowercase letter and a number.',
        );
      }
      hashed_password = await bcrypt.hash(pw, 10);
    }

    // The store needs a number; use the shop one unless another store has it.
    const phone = String(dto.phone_number || shopper.phone_number || '').trim();
    if (!phone) {
      throw new BadRequestException('Add a phone number for your store.');
    }
    if (await this.phoneTaken(phone, UserType.VENDOR)) {
      throw new ConflictException(
        'Another store already uses this phone number. Use a different one.',
      );
    }

    const { user, business } = await this.createStoreAccount({
      full_name: shopper.full_name,
      email: shopper.email,
      phone_number: phone,
      hashed_password,
      email_verified: true,
      verification_code: null,
      business: { business_name: name },
    });

    this.notifyNewVendor(business);
    this.sendWelcomeEmail(user, business).catch(() => {});

    const vendorUrl =
      process.env.VENDOR_FRONTEND_URL || 'https://vendor.qlozet.app';
    return {
      message: shopper.hashed_password
        ? 'Your store is ready. Sign in to the vendor app with the same email and password.'
        : 'Your store is ready. Sign in to the vendor app with this email and the password you just set.',
      data: {
        business: sanitizeBusiness(business),
        email: user.email,
        vendor_login_url: `${vendorUrl}/auth/sign-in?email=${encodeURIComponent(user.email)}`,
      },
    };
  }

  /** Most stores one person may own; stops throwaway store farming. */
  static readonly MAX_OWNED_STORES = 5;

  /**
   * Sign-up with an email that already has a store login (typically someone
   * on another store's team). Their password proves it is them; the new store
   * joins the same login and they switch between stores from the picker.
   */
  private async addStoreToLogin(
    vendor: UserDocument,
    password: string,
    input: Record<string, any> & {
      business_name: string;
      personal_phone_number?: string;
    },
  ) {
    const same =
      !!vendor.hashed_password &&
      (await bcrypt.compare(password, vendor.hashed_password));
    if (!same) {
      throw new ConflictException(
        'You already have a Qlozet store login with this email. Use that password to open your own store, or reset it with Forgot password.',
      );
    }
    const { personal_phone_number, ...business } = input;
    const { user, business: created } = await this.openStoreOnLogin(
      vendor,
      business as any,
      personal_phone_number,
    );
    const token = await this.issueSession(user);
    return {
      data: {
        user: sanitizeUser(user),
        business: sanitizeBusiness(created),
        token,
        added_to_existing_login: true,
      },
      message:
        'Your store is ready. It is on the login you already have; switch between your stores from the store menu.',
    };
  }

  /**
   * A signed-in store account opens a store of its own (from the store
   * picker). They own it; their place on any other team is unchanged.
   */
  async openAnotherStore(
    userId: string,
    dto: { business_name: string; phone_number?: string },
  ) {
    const vendor = await this.userModel
      .findById(userId)
      .select('+hashed_password');
    if (!vendor || vendor.type !== UserType.VENDOR) {
      throw new BadRequestException('Sign in to the vendor app first.');
    }
    const { user, business } = await this.openStoreOnLogin(
      vendor,
      { business_name: dto.business_name },
      dto.phone_number,
    );
    return {
      message: `${business.business_name} is ready. You're now working in it.`,
      data: {
        user: sanitizeUser(user),
        business: sanitizeBusiness(business),
      },
    };
  }

  /** The checks and the store, shared by both ways in above. */
  private async openStoreOnLogin(
    vendor: UserDocument,
    business: Record<string, any> & { business_name: string },
    phone?: string,
  ) {
    if (vendor.status && vendor.status !== 'active') {
      throw new ForbiddenException('This account is closed.');
    }
    if (!vendor.email_verified) {
      throw new BadRequestException(
        'Verify your email before opening a store.',
      );
    }
    if ((vendor as any).must_change_password) {
      throw new ForbiddenException(
        'Sign in and set your own password before opening a store.',
      );
    }
    const name = String(business.business_name ?? '').trim();
    if (name.length < 2) {
      throw new BadRequestException(
        'Enter your store name (at least 2 characters).',
      );
    }
    await this.assertBusinessContactsFree(
      business.business_email,
      business.business_phone_number,
    );

    const owned = await this.teamMemberModel.countDocuments({
      ...ObjectIdUtils.refMatch('user', String(vendor._id)),
      is_owner: true,
    });
    if (owned >= AuthService.MAX_OWNED_STORES) {
      throw new BadRequestException(
        `You already own ${owned} stores, the most one person can open. Contact support if you need more.`,
      );
    }

    // A number for the login if it has none yet, unless another store has it.
    const newPhone = phone && !vendor.phone_number ? phone : undefined;
    if (newPhone) {
      const holder = await this.userModel.findOne({
        phone_number: newPhone,
        type: UserType.VENDOR,
      });
      if (holder && String(holder._id) !== String(vendor._id)) {
        throw new ConflictException(
          'Another store already uses this phone number. Use a different one.',
        );
      }
    }

    const created = await this.createStoreAccount({
      existingUser: vendor,
      ...(newPhone && { phone_number: newPhone }),
      full_name: vendor.full_name,
      email: vendor.email,
      hashed_password: vendor.hashed_password ?? '', // unused: the login exists
      email_verified: true,
      verification_code: null,
      business: { ...business, business_name: name },
    });
    this.notifyNewVendor(created.business);
    this.sendWelcomeEmail(created.user, created.business).catch(() => {});
    return created;
  }

  /** A business email or number already belongs to another store. */
  private async assertBusinessContactsFree(
    business_email?: string,
    business_phone_number?: string,
  ) {
    // Only check what was provided: { field: undefined } matches as null,
    // which would hit every business without that field.
    const or: Record<string, string>[] = [];
    if (business_email) or.push({ business_email });
    if (business_phone_number) or.push({ business_phone_number });
    if (!or.length) return;
    const existing = await this.businessModel.findOne({ $or: or });
    if (existing) {
      const field =
        business_email && existing.business_email === business_email
          ? 'email'
          : 'phone number';
      throw new ConflictException(
        `A business with this ${field} already exists.`,
      );
    }
  }

  /**
   * A sign-up that was never verified (typo in the email, never got the
   * code) shouldn't keep holding its phone number, or the person can't try
   * again with the right email. Only the number is removed: if that account
   * was real it can still be verified, and adds a number later.
   */
  private async releasePhoneFromUnverified(
    phone: string | undefined,
    type: UserType,
  ) {
    if (!phone) return;
    const res = await this.userModel.updateMany(
      { phone_number: phone, type, email_verified: { $ne: true } },
      { $unset: { phone_number: 1 } },
    );
    if (res?.modifiedCount) {
      this.logger.log(
        `Released ${phone.slice(0, 5)}… from an unverified ${type} sign-up`,
      );
    }
  }

  /** Another account of this type already has the number. */
  private async phoneTaken(phone: string | undefined, type: UserType) {
    if (!phone) return false;
    return !!(await this.userModel.exists({ phone_number: phone, type }));
  }

  /**
   * The store account and everything it needs, in one transaction: the
   * vendor user, the business, the owner's team record, wallet and tokens.
   */
  private async createStoreAccount(input: {
    full_name: string;
    email: string;
    phone_number?: string;
    hashed_password: string;
    email_verified: boolean;
    /** Emailed after commit by the caller; null when the email is proven. */
    verification_code: string | null;
    display_picture_url?: string;
    business: Record<string, any> & { business_name: string };
    /**
     * A store login that already exists (a team member or an owner opening
     * another store): the store joins it instead of a new user being made.
     */
    existingUser?: UserDocument;
  }): Promise<{ user: UserDocument; business: BusinessDocument }> {
    const ownerRole = await this.roleModel.findOne({ name: VendorRole.OWNER });
    if (!ownerRole) throw new BadRequestException('Vendor role not found.');

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const code = input.verification_code;
      if (input.existingUser && input.phone_number) {
        await this.userModel.updateOne(
          { _id: input.existingUser._id },
          { $set: { phone_number: input.phone_number } },
          { session },
        );
        input.existingUser.phone_number = input.phone_number;
      }
      const [vendorUser] = input.existingUser
        ? [input.existingUser]
        : await this.userModel.create(
            [
              {
                full_name: input.full_name,
                email: input.email,
                ...(input.phone_number
                  ? { phone_number: input.phone_number }
                  : {}),
                hashed_password: input.hashed_password,
                role: ownerRole._id,
                type: UserType.VENDOR,
                email_verified: input.email_verified,
                ...(input.email_verified || !code
                  ? { email_verified_at: new Date() }
                  : {
                      email_verification_token: createHash(code),
                      email_verification_expires: new Date(
                        Date.now() + VERIFY_CODE_TTL_MS,
                      ),
                      email_verification_attempts: 0,
                      last_verification_email_sent: new Date(),
                    }),
                status: 'active',
                profilePicture: input.display_picture_url || '',
              },
            ],
            { session },
          );

      const { business_logo_url, cover_image_url, ...businessFields } =
        input.business;
      const [business] = await this.businessModel.create(
        [
          {
            ...businessFields,
            display_picture_url: input.display_picture_url ?? '',
            business_logo_url: business_logo_url ?? '',
            cover_image_url: cover_image_url ?? '',
            created_by: {
              id: vendorUser._id,
              name: vendorUser.full_name,
              email: vendorUser.email,
            },
            team_members: [],
          },
        ],
        { session },
      );

      const [ownerMember] = await this.teamMemberModel.create(
        [
          {
            business: business._id,
            user: vendorUser._id,
            role: ownerRole._id,
            full_name: vendorUser.full_name,
            email: vendorUser.email,
            phone_number: vendorUser.phone_number,
            accepted: true,
            is_owner: true,
            is_active: true,
          },
        ],
        { session },
      );

      await this.businessModel.findByIdAndUpdate(
        business._id,
        { $push: { team_members: ownerMember._id } },
        { session },
      );

      await this.walletModel.create(
        [{ business: business._id, balance: 0, currency: 'NGN' }],
        { session },
      );

      // Wallet starts empty — the vendor signup token reward (admin-tunable)
      // is granted once, when the business is approved, so throwaway
      // registrations can't farm tokens.
      await this.tokenModel.create([{ business: business._id, tokens: 0 }], {
        session,
      });

      await this.userModel.updateOne(
        { _id: vendorUser._id },
        { $set: { business: business._id } },
        { session },
      );
      (vendorUser as any).business = business._id;

      await session.commitTransaction();
      return { user: vendorUser, business };
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(
        `Vendor registration failed: ${error?.message || error}`,
        error?.stack,
      );
      // Two sign-ups racing for the same email or number.
      if (error?.code === 11000) {
        throw new ConflictException(
          'A store account with this email or phone number already exists.',
        );
      }
      throw error instanceof BadRequestException ||
        error instanceof ConflictException
        ? error
        : new InternalServerErrorException(
            `Vendor registration failed: ${error?.message || 'Unknown error'}`,
          );
    } finally {
      session.endSession();
    }
  }

  /**
   * Admin work queue: a new business is waiting for approval. After the
   * commit and fire-and-forget — registration must not fail on this.
   */
  private notifyNewVendor(business: BusinessDocument) {
    this.notificationsService.notifyPlatformAdmins({
      category: NotificationCategory.SYSTEM,
      type: NotificationType.VENDOR_APPLICATION,
      title: 'New Vendor Application',
      body: `${business.business_name} registered and is awaiting approval.`,
      metadata: {
        business_id: business._id,
        business_name: business.business_name,
        business_email: business.business_email,
      },
      action_url: `/vendors/${business._id}`,
    });
  }

  /** Tokens for a new session, with the refresh token stored hashed. */
  private async issueSession(user: UserDocument): Promise<Tokens> {
    const token = await this.generateToken({ id: user._id, email: user.email });
    const hashedRt = await bcrypt.hash(token.refresh_token, 10);
    await this.userModel.findByIdAndUpdate(user._id, {
      refreshToken: hashedRt,
    });
    return token;
  }

  /**
   * Give the linked account (same email, the other of shop / store) the
   * same password. Staff accounts never take part.
   */
  private async syncLinkedPassword(user: UserDocument, hashed: string) {
    if (!LINKABLE_TYPES.includes(user.type)) return;
    await this.userModel.updateMany(
      {
        email: user.email,
        type: { $in: LINKABLE_TYPES },
        _id: { $ne: user._id },
      },
      { $set: { hashed_password: hashed } },
    );
  }

  /**
   * Register a new customer
   */
  async registerCustomer(data: CustomerRegistrationDto): Promise<{
    data: { user: any };
    message: string;
  }> {
    const { full_name, email, phone_number, password, dob, ...customerData } =
      data;

    // Only other SHOPPING accounts and staff block the email; a store owner
    // gets a shopping account by signing in on the shop (linked-accounts.ts).
    const sameEmail = await this.userModel.find({ email });
    const existingUser = sameEmail.find((u) => u.type === UserType.CUSTOMER);
    if (existingUser) {
      // Abandoned signup → guide back to verification instead of dead-ending.
      if (!existingUser.email_verified) {
        await this.resendVerificationEmail(
          existingUser.email,
          UserType.CUSTOMER,
        ).catch(() => {});
        throw new ConflictException(
          "This account already exists but isn't verified — we've sent a new code to your email.",
        );
      }
      throw new ConflictException('Email or phone number already in use');
    }
    if (sameEmail.some((u) => u.type === UserType.PLATFORM)) {
      throw new ConflictException('Email or phone number already in use');
    }
    if (sameEmail.some((u) => u.type === UserType.VENDOR)) {
      throw new ConflictException(
        'You have a Qlozet store with this email. Sign in with the same email and password; your shopping account is set up automatically.',
      );
    }
    await this.releasePhoneFromUnverified(phone_number, UserType.CUSTOMER);
    if (await this.phoneTaken(phone_number, UserType.CUSTOMER)) {
      throw new ConflictException('Email or phone number already in use');
    }

    const role = await this.roleModel.findOne({ name: UserRole.CUSTOMER });
    if (!role) throw new BadRequestException('Customer role not found');

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const otp = generateOtp();
      const email_verification_token = createHash(otp);
      const hashed_password = await bcrypt.hash(password, 10);

      const [newUser] = await this.userModel.create(
        [
          {
            full_name,
            email,
            phone_number,
            hashed_password,
            role: role._id,
            type: UserType.CUSTOMER,
            email_verified: false,
            email_verification_token,
            email_verification_expires: new Date(
              Date.now() + VERIFY_CODE_TTL_MS,
            ),
            email_verification_attempts: 0,
            status: 'active',
            dob: dob ? new Date(dob) : undefined,
            last_verification_email_sent: new Date(),
            ...customerData,
          },
        ],
        { session },
      );

      await this.provisionCustomer(newUser._id as Types.ObjectId, session);

      await session.commitTransaction();

      await this.sendVerificationEmail(newUser, otp);

      this.logger.log(`Customer registered successfully: ${email}`);

      return {
        data: { user: sanitizeUser(newUser) },
        message:
          'Customer registered successfully. Please check your email to verify your account.',
      };
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(
        `Customer registration failed: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Registration failed. Please try again.',
      );
    } finally {
      session.endSession();
    }
  }

  /**
   * Everything a customer account needs besides the user document itself.
   *
   * Shared by email registration and by Google sign-up so a provider account
   * cannot end up without a wallet - which would fail the first time they
   * tried to pay from balance, long after signup, with nothing to point at.
   */
  private async provisionCustomer(
    customerId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.walletModel.create(
      [{ customer: customerId, balance: 0, currency: 'NGN' }],
      { session },
    );

    // Signup token reward — admin-tunable (0 = off). The grant is keyed by
    // `customer`; there is no `user` field on the Token schema.
    const settings = await this.platformSettingsModel.findOne().lean();
    const signupTokens = settings?.customer_signup_token_reward ?? 100;
    await this.tokenModel.create(
      [
        {
          customer: customerId,
          tokens: signupTokens,
          lifetimeEarned: signupTokens,
          signup_reward_granted: signupTokens > 0,
        },
      ],
      { session },
    );
  }

  /**
   * Send the verification code. The button in the email opens the code
   * screen of the app this account uses, with the email filled in (the old
   * link went to a /verify-email page neither app has). With `throwOnFail`
   * a mail-server failure reaches the caller instead of being logged and
   * reported as sent.
   */
  private async sendVerificationEmail(
    user: UserDocument,
    code: string,
    opts: { throwOnFail?: boolean } = {},
  ) {
    try {
      const email = encodeURIComponent(user.email);
      const verificationLink =
        user.type === UserType.VENDOR
          ? `${process.env.VENDOR_FRONTEND_URL || process.env.FRONTEND_URL}/auth/verification?email=${email}`
          : `${process.env.FRONTEND_URL}/auth/register?step=otp&email=${email}`;

      await this.mailService.sendVerificationEmail(
        user.email,
        user.full_name,
        verificationLink,
        code,
      );

      // Update email tracking fields
      await this.userModel.findByIdAndUpdate(user._id, {
        lastVerificationEmailSent: new Date(),
        last_verification_email_sent: new Date(),
        $inc: { verificationEmailAttempts: 1 },
      });

      this.logger.log(`Verification email sent to ${user.type} ${user._id}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${user.type} ${user._id}: ${(error as any)?.message}`,
      );
      if (opts.throwOnFail) {
        throw new ServiceUnavailableException(
          "We couldn't send the email just now. Check the address is right and try again in a minute.",
        );
      }
    }
  }

  /**
   * Send welcome email after verification
   */
  private async sendWelcomeEmail(
    user: UserDocument,
    business?: BusinessDocument,
  ) {
    try {
      if (user.type === UserType.VENDOR && business) {
        await this.mailService.sendVendorWelcomeEmail(
          user.email,
          user.full_name,
          business.business_name,
        );

        // Update welcome email tracking
        await this.userModel.findByIdAndUpdate(user._id, {
          lastWelcomeEmailSent: new Date(),
        });

        this.logger.log(`Vendor welcome email sent to: ${user.email}`);
      } else if (user.type === UserType.CUSTOMER) {
        await this.mailService.sendCustomerWelcomeEmail(
          user.email,
          user.full_name,
        );

        // Update welcome email tracking
        await this.userModel.findByIdAndUpdate(user._id, {
          lastWelcomeEmailSent: new Date(),
        });

        this.logger.log(`Customer welcome email sent to: ${user.email}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send welcome email to ${user.email}:`,
        error,
      );
      // Don't throw error as user is already verified
    }

    // In-app welcome notification
    try {
      const isVendor = user.type === UserType.VENDOR;
      await this.notificationsService.create({
        recipient: (user._id as Types.ObjectId).toString(),
        audience: isVendor ? 'vendor' : 'customer',
        category: NotificationCategory.SYSTEM,
        type: NotificationType.WELCOME,
        title: isVendor ? 'Welcome to Qlozet!' : 'Welcome to Qlozet!',
        body: isVendor
          ? `Your store ${business?.business_name || ''} is ready. Start adding products to your catalog!`
          : 'Start exploring products from amazing vendors. Happy shopping!',
        metadata: {
          user_type: user.type,
          business_name: business?.business_name,
        },
        action_url: isVendor ? '/products' : '/',
      });
    } catch (err) {
      this.logger.warn(`Failed to create welcome notification: ${err.message}`);
    }
  }

  /**
   * Generate email verification token
   */

  /**
   * Verify email address
   */
  async verifyEmail(code: string, email?: string) {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      let user: UserDocument | null;
      if (/^\d{6}$/.test(code)) {
        // A 6-digit code is checked against ONE account, the one it was sent
        // to: looking codes up on their own let anyone try codes against
        // every unverified account at once.
        if (!email) {
          throw new BadRequestException(
            'Enter the email address the code was sent to.',
          );
        }
        // An email can hold a shopping and a store account (linked-accounts.ts);
        // the code belongs to whichever of them is waiting for one. If both
        // are, the code itself says which; a wrong code counts against the
        // newest.
        const waiting = await this.userModel
          .find(
            {
              email: email.trim().toLowerCase(),
              email_verified: { $ne: true },
            },
            null,
            { session },
          )
          .sort({ createdAt: -1 })
          .select(
            '+email_verification_token +email_verification_expires +email_verification_attempts',
          );
        user =
          waiting.find(
            (u) => u.email_verification_token === createHash(code),
          ) ??
          waiting[0] ??
          null;
        if (!user || user.email_verified) {
          throw new BadRequestException(
            "That code isn't right, or this email is already verified.",
          );
        }
        if (
          !user.email_verification_token ||
          !user.email_verification_expires ||
          user.email_verification_expires <= new Date()
        ) {
          throw new BadRequestException(
            'This code has expired. Request a new one.',
          );
        }
        if ((user.email_verification_attempts ?? 0) >= MAX_VERIFY_ATTEMPTS) {
          throw new BadRequestException(
            'Too many wrong codes. Request a new one.',
          );
        }
        if (createHash(code) !== user.email_verification_token) {
          await this.userModel.updateOne(
            { _id: user._id },
            { $inc: { email_verification_attempts: 1 } },
            { session },
          );
          await session.commitTransaction();
          session.endSession();
          const left =
            MAX_VERIFY_ATTEMPTS - ((user.email_verification_attempts ?? 0) + 1);
          throw new BadRequestException(
            left > 0
              ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
              : 'Too many wrong codes. Request a new one.',
          );
        }
      } else {
        // Long tokens from older emails' links.
        user = await this.userModel.findOne(
          {
            email_verification_token: code,
            email_verification_expires: { $gt: new Date() },
          },
          null,
          { session },
        );
        if (!user) {
          throw new BadRequestException(
            'Invalid or expired verification token',
          );
        }
      }

      Object.assign(user, {
        email_verified: true,
        email_verification_token: undefined,
        email_verification_expires: undefined,
        email_verification_attempts: 0,
        status: 'active',
        email_verified_at: new Date(),
      });

      await user.save({ session });
      await session.commitTransaction();
      session.endSession();

      const token = await this.generateToken({
        id: user._id,
        email: user.email,
      });

      const hashedRt = await bcrypt.hash(token.refresh_token, 10);

      await this.userModel.findByIdAndUpdate(user._id, {
        refreshToken: hashedRt,
      });

      this.sendWelcomeEmail(user).catch((err) => {
        this.logger.error(`Welcome email failed for ${user.email}:`, err);
      });

      this.logger.log(`Email verified successfully: ${user.email}`);

      return {
        message: 'Email verified successfully! Welcome to our platform.',
        data: {
          user: sanitizeUser(user),
          token,
        },
      };
    } catch (error) {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
      this.logger.warn(`Email verification failed: ${(error as any)?.message}`);
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  /**
   * Sign-in with the right password on an unverified account: send a new
   * code (same rules as Resend: at most one a minute) and refuse the sign-in
   * with a message saying what happened. Every message contains "verify your
   * email"; the vendor app and the shop match that to open the code screen.
   * Runs only after the password check, so nobody can learn an account is
   * unverified, or trigger emails, from the email address alone.
   */
  private async refuseUnverifiedLogin(
    email: string,
    type?: UserType,
  ): Promise<never> {
    try {
      await this.resendVerificationEmail(email, type);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new UnauthorizedException(
          "Please verify your email. We couldn't send a new code just now; tap Resend on the next screen.",
        );
      }
      // The one-a-minute limit: a code went out moments ago.
      throw new UnauthorizedException(
        'Please verify your email. We sent you a code less than a minute ago; check your inbox and spam.',
      );
    }
    throw new UnauthorizedException(
      "Please verify your email. We've sent a new code to your inbox.",
    );
  }

  async resendVerificationEmail(
    email: string,
    type?: UserType,
  ): Promise<{ message: string }> {
    const address = String(email ?? '')
      .trim()
      .toLowerCase();
    // The account waiting for a code (an email may hold a shopping and a
    // store account; at most one of them is normally unverified).
    const user = await this.userModel
      .findOne({
        email: address,
        email_verified: { $ne: true },
        ...(type ? { type } : {}),
      })
      .sort({ createdAt: -1 })
      .select('+email_verification_token +email_verification_expires');

    if (!user) {
      const any = await this.userModel.exists({ email: address });
      if (!any) {
        throw new NotFoundException('User not found with this email address.');
      }
      throw new BadRequestException('Email is already verified.');
    }

    // One email a minute. This used to read the welcome email's
    // timestamp, so it never applied.
    const last = user.last_verification_email_sent?.getTime();
    if (last && Date.now() - last < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - last)) / 1000);
      throw new BadRequestException(
        `Please wait ${wait} seconds before requesting another code.`,
      );
    }

    // Every email carries the code that is stored: the newest code works,
    // earlier ones stop.
    const otp = generateOtp();
    user.email_verification_token = createHash(otp);
    user.email_verification_expires = new Date(Date.now() + VERIFY_CODE_TTL_MS);
    (user as any).email_verification_attempts = 0;
    await user.save();

    // Waited for, so a mail failure is reported instead of "sent".
    await this.sendVerificationEmail(user, otp, { throwOnFail: true });

    this.logger.log(`Verification code resent to user ${user._id}`);
    return {
      message:
        'A new code is on its way. It replaces any earlier code and works for 30 minutes.',
    };
  }

  /**
   * Check verification status
   */
  async checkVerificationStatus(userId: string): Promise<{
    verified: boolean;
    userType: UserType;
    status: string;
    email_verifiedAt?: Date;
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      verified: user.email_verified,
      userType: user.type,
      status: user.status,
      email_verifiedAt: user.email_verified_at,
    };
  }

  /**
   * Login vendor (supports multi-business)
   */
  async loginVendor(email: string, password: string) {
    try {
      const vendor = await this.userModel
        .findOne({ email, type: UserType.VENDOR })
        .select('+hashed_password')
        .exec();

      if (!vendor) {
        // A shopper trying the vendor app: say how to open a store, but only
        // once the password is right, so nobody learns who shops here.
        const shopper = await this.userModel
          .findOne({ email, type: UserType.CUSTOMER })
          .select('+hashed_password');
        if (
          shopper?.hashed_password &&
          (await bcrypt.compare(password, shopper.hashed_password))
        ) {
          throw new UnauthorizedException(
            "This is your shopping account; you don't have a store yet. Tap Sign up and use this same email and password to open one.",
          );
        }
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if account is active
      if (vendor.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
      }

      // hashed_password is optional on the schema because provider accounts have
      // none. Guard before comparing: bcrypt.compare throws on undefined rather
      // than returning false.
      if (!vendor.hashed_password) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const validPassword = await bcrypt.compare(
        password,
        vendor.hashed_password,
      );
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Only after the password: an unverified account gets a fresh code.
      if (!vendor.email_verified) {
        await this.refuseUnverifiedLogin(vendor.email, UserType.VENDOR);
      }

      // Look up ALL businesses this user belongs to
      const teamMemberships = await this.teamMemberModel
        .find({ user: vendor._id })
        .populate('business', 'business_name business_logo_url status')
        .populate('role', 'name description')
        .exec();

      if (!teamMemberships.length) {
        throw new UnauthorizedException(
          'You are not a member of any business. Please contact your business owner.',
        );
      }

      // Build businesses array. A store whose owner deactivated this member
      // is left out: they can no longer work in it.
      const usable = teamMemberships.filter((tm: any) => tm.business);
      if (usable.length && usable.every((tm: any) => tm.is_active === false)) {
        throw new UnauthorizedException(
          'The store owner has turned off your access. Contact them to have it turned back on.',
        );
      }
      const businesses = usable
        .filter((tm: any) => tm.is_active !== false)
        .map((tm: any) => ({
          _id: tm.business._id,
          business_name: tm.business.business_name,
          business_logo_url: tm.business.business_logo_url || null,
          status: tm.business.status,
          role: tm.role?.name || 'unknown',
          role_id: tm.role?._id || null,
          is_owner: tm.is_owner || false,
        }));

      if (!businesses.length) {
        throw new UnauthorizedException(
          'You are not a member of any active business.',
        );
      }

      // Auto-select business: use current user.business if still valid, else first one
      let activeBusiness = businesses[0];
      if (vendor.business) {
        const current = businesses.find(
          (b: any) => b._id.toString() === vendor.business.toString(),
        );
        if (current) activeBusiness = current;
      }

      // Update user's active business
      await this.userModel.findByIdAndUpdate(vendor._id, {
        business: activeBusiness._id,
      });

      const token = await this.generateToken({
        id: vendor._id,
        email: vendor.email,
      });
      const hashedRt = await bcrypt.hash(token.refresh_token, 10);
      await this.userModel.findByIdAndUpdate(vendor._id, {
        refresh_token: hashedRt,
      });

      this.stampLastLogin(vendor._id);

      return {
        message: 'Login successful. Welcome back!',
        data: {
          user: sanitizeUser(vendor),
          token,
          businesses,
          active_business: activeBusiness,
          must_change_password: vendor.must_change_password || false,
        },
      };
    } catch (error) {
      this.logger.error(`Vendor login failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Switch active business for a vendor user
   */
  async switchBusiness(userId: string, businessId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Verify user is a team member of the target business. Match both refs
    // type-agnostically: some legacy TeamMember records store `user`/`business`
    // as plain strings, which a strict ObjectId-casting query silently misses —
    // producing a false "not a member" (401) even for a valid membership the
    // switch UI just listed.
    const membership = await this.teamMemberModel
      .findOne({
        $and: [
          ObjectIdUtils.refMatch('user', userId),
          ObjectIdUtils.refMatch('business', businessId),
        ],
      })
      .populate('business', 'business_name business_logo_url status')
      .populate('role', 'name description')
      .exec();

    if (!membership) {
      throw new UnauthorizedException('You are not a member of this business.');
    }
    if (
      (membership as any).is_active === false &&
      !(membership as any).is_owner
    ) {
      throw new ForbiddenException(
        'The store owner has turned off your access to this store.',
      );
    }
    // The store must still exist, and list this member (the roles guard
    // checks that list on every request, so a switch it would refuse is
    // refused here instead of succeeding and then failing everywhere).
    const target: any = membership.business;
    const listed = target?._id
      ? await this.businessModel.exists({
          _id: target._id,
          team_members: membership._id,
        })
      : null;
    if (!listed) {
      throw new UnauthorizedException('You are not a member of this business.');
    }

    // Update active business
    await this.userModel.findByIdAndUpdate(userId, {
      business: businessId,
    });

    // Generate fresh token
    const token = await this.generateToken({
      id: user._id,
      email: user.email,
    });
    const hashedRt = await bcrypt.hash(token.refresh_token, 10);
    await this.userModel.findByIdAndUpdate(userId, {
      refresh_token: hashedRt,
    });

    const business: any = membership.business;
    const role: any = membership.role;

    return {
      message: `Switched to ${business?.business_name || 'business'} successfully.`,
      data: {
        token,
        active_business: {
          _id: business._id,
          business_name: business.business_name,
          business_logo_url: business.business_logo_url || null,
          status: business.status,
          role: role?.name || 'unknown',
          role_id: role?._id || null,
          is_owner: (membership as any).is_owner || false,
        },
      },
    };
  }

  /**
   * Platform admin login
   */
  async loginPlatform(email: string, password: string) {
    try {
      const user = await this.userModel
        .findOne({ email, type: UserType.PLATFORM })
        .select('+hashed_password')
        .populate('role', 'name type')
        .exec();

      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (user.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
      }

      // hashed_password is optional on the schema because provider accounts have
      // none. Guard before comparing: bcrypt.compare throws on undefined rather
      // than returning false.
      if (!user.hashed_password) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const validPassword = await bcrypt.compare(
        password,
        user.hashed_password,
      );
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const token = await this.generateToken({
        id: user._id,
        email: user.email,
      });
      const hashedRt = await bcrypt.hash(token.refresh_token, 10);
      await this.userModel.findByIdAndUpdate(user._id, {
        refreshToken: hashedRt,
      });

      this.stampLastLogin(user._id);

      return {
        message: 'Platform admin login successful.',
        data: {
          user: sanitizeUser(user),
          token,
          // True while the emailed temporary password is in use; the console
          // sends the person to set a new one before anything else.
          must_change_password: Boolean(user.must_change_password),
        },
      };
    } catch (error) {
      this.logger.error(`Platform login failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(userId: string, refreshToken: string): Promise<Tokens> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.refresh_token) {
      throw new UnauthorizedException('Access denied');
    }
    const rtMatches = await bcrypt.compare(refreshToken, user.refresh_token);
    if (!rtMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const jwtPayload: JwtPayload = {
      id: user._id,
      email: user.email,
    };

    const tokens = await this.generateToken(jwtPayload);

    const hashedRt = await bcrypt.hash(tokens.refresh_token, 10);
    await this.userModel.findByIdAndUpdate(user._id, {
      refreshToken: hashedRt,
    });

    return tokens;
  }

  /**
   * Make the shopping account for someone who so far only has a store
   * (linked-accounts.ts). Proof is the store password or a verified Google
   * sign-in for the same email. Returns null when there is no such store
   * owner or the proof fails, so the caller answers as it would anyway.
   */
  private async shoppingAccountForStoreOwner(
    email: string,
    proof: { password: string } | { google: { sub: string; picture?: string } },
  ): Promise<UserDocument | null> {
    const owner = await this.userModel
      .findOne({ email, type: UserType.VENDOR })
      .select('+hashed_password');
    if (!owner || owner.status !== 'active') return null;

    if ('password' in proof) {
      if (!owner.hashed_password) return null;
      if (!(await bcrypt.compare(proof.password, owner.hashed_password))) {
        return null;
      }
      // An unproven email can't open a second account on the back of it.
      if (!owner.email_verified) return null;
    }

    const role = await this.roleModel.findOne({ name: UserRole.CUSTOMER });
    if (!role) throw new BadRequestException('Customer role not found');

    // Keep the number unless another shopper already has it.
    const phone =
      owner.phone_number &&
      !(await this.phoneTaken(owner.phone_number, UserType.CUSTOMER))
        ? owner.phone_number
        : undefined;
    const google = 'google' in proof ? proof.google : null;

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const [created] = await this.userModel.create(
        [
          {
            full_name: owner.full_name,
            email: owner.email,
            ...(phone ? { phone_number: phone } : {}),
            ...(owner.hashed_password
              ? { hashed_password: owner.hashed_password }
              : {}),
            role: role._id,
            type: UserType.CUSTOMER,
            auth_provider:
              google && !owner.hashed_password
                ? AuthProvider.GOOGLE
                : AuthProvider.LOCAL,
            ...(google ? { google_id: google.sub } : {}),
            ...(google?.picture ? { profile_picture: google.picture } : {}),
            email_verified: true,
            email_verified_at: new Date(),
            status: 'active',
          },
        ],
        { session },
      );
      await this.provisionCustomer(created._id as Types.ObjectId, session);
      await session.commitTransaction();
      this.logger.log(`Shopping account created for store owner ${owner._id}`);
      this.sendWelcomeEmail(created).catch(() => {});
      return this.userModel
        .findById(created._id)
        .select('+hashed_password +google_id');
    } catch (error) {
      await session.abortTransaction();
      // Two sign-ins at once: the other one made it; use that.
      if (error?.code === 11000) {
        return this.userModel
          .findOne({ email, type: UserType.CUSTOMER })
          .select('+hashed_password +google_id');
      }
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Login customer
   */
  async loginCustomer(email: string, password: string) {
    try {
      let user: UserDocument | null = await this.userModel
        .findOne({ email, type: UserType.CUSTOMER })
        .select('+hashed_password');
      if (!user) {
        // A store owner shopping for the first time: their store password
        // proves who they are, so their shopping account is made right here.
        user = await this.shoppingAccountForStoreOwner(email, { password });
      }
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if account is active
      if (user.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
      }

      if (!user.hashed_password) {
        // Signed up through a provider and never set a password. Saying so beats
        // "invalid credentials", which sends someone off to reset a password
        // that does not exist.
        throw new UnauthorizedException(
          user.auth_provider === AuthProvider.GOOGLE
            ? 'You signed up with Google. Use the Continue with Google button.'
            : 'Invalid credentials',
        );
      }

      const validPassword = await bcrypt.compare(
        password,
        user.hashed_password,
      );
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Only after the password: an unverified account gets a fresh code.
      if (!user.email_verified) {
        await this.refuseUnverifiedLogin(user.email, UserType.CUSTOMER);
      }

      const token = await this.generateToken({
        id: user._id,
        email: user.email,
      });

      this.stampLastLogin(user._id);

      return {
        message: 'Login successful. Welcome back!',
        data: {
          user: sanitizeUser(user),
          token,
        },
      };
    } catch (error) {
      this.logger.error(`Customer login failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Sign a customer in with a Google ID token.
   *
   * The token is verified against Google rather than trusted: a client can
   * send any string, and decoding one without checking its signature and
   * audience is the whole vulnerability. verifyIdToken checks the signature,
   * the expiry, and that the token was minted for *our* client id - without
   * the audience check an attacker could present a valid Google token issued
   * to some other app.
   */
  async loginWithGoogle(idToken: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      this.logger.error('GOOGLE_CLIENT_ID is not configured');
      throw new InternalServerErrorException(
        'Google sign-in is not available right now.',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(`Google token verification failed: ${error.message}`);
      throw new UnauthorizedException('Could not verify your Google account.');
    }

    if (!payload?.email || !payload.sub) {
      throw new UnauthorizedException('Could not verify your Google account.');
    }

    /**
     * Google tells us whether it has verified the address. An unverified one
     * must not be accepted: it is the difference between "Google says this
     * person owns the mailbox" and "this person typed that address in", and
     * the second would let anyone claim an existing account below.
     */
    if (payload.email_verified !== true) {
      throw new UnauthorizedException(
        'Your Google account email is not verified.',
      );
    }

    const email = payload.email.toLowerCase();
    // The shopping account for this email. A store owner without one gets it
    // made now: Google has just proven the email (linked-accounts.ts).
    let existing: UserDocument | null = await this.userModel
      .findOne({ email, type: UserType.CUSTOMER })
      .select('+google_id');
    // A shopping account made just now, so the shop can run its welcome steps.
    let isNewUser = false;
    if (!existing) {
      if (await this.userModel.exists({ email, type: UserType.PLATFORM })) {
        throw new UnauthorizedException(
          'This email belongs to a staff account. Sign in with your password.',
        );
      }
      existing = await this.shoppingAccountForStoreOwner(email, {
        google: { sub: payload.sub, picture: payload.picture },
      });
      isNewUser = !!existing;
    }

    if (existing) {
      if (existing.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
      }

      /**
       * Linking an existing password account to Google is safe only because
       * Google has verified the address above - the person demonstrably
       * controls the mailbox that account was opened with. The local password
       * is left in place, so they can still use either route.
       */
      const updates: Record<string, unknown> = { last_login: new Date() };
      if (!existing.google_id) updates.google_id = payload.sub;
      if (!existing.email_verified) updates.email_verified = true;
      await this.userModel.updateOne({ _id: existing._id }, { $set: updates });

      const token = await this.generateToken({
        id: existing._id,
        email: existing.email,
      });
      return {
        message: 'Login successful. Welcome back!',
        data: { user: sanitizeUser(existing), token, is_new_user: isNewUser },
      };
    }

    // ---- New account -------------------------------------------------
    const role = await this.roleModel.findOne({ name: UserRole.CUSTOMER });
    if (!role) throw new BadRequestException('Customer role not found');

    const session = await this.connection.startSession();
    session.startTransaction();
    try {
      const [newUser] = await this.userModel.create(
        [
          {
            full_name: payload.name?.trim() || email.split('@')[0],
            email,
            role: role._id,
            type: UserType.CUSTOMER,
            auth_provider: AuthProvider.GOOGLE,
            google_id: payload.sub,
            // Google has verified the address, so there is no code to send
            // and nothing for the customer to come back from.
            email_verified: true,
            status: 'active',
            ...(payload.picture ? { profile_picture: payload.picture } : {}),
            // No phone number: Google does not supply one, and the number
            // that matters for delivery is captured on the shipping address.
          },
        ],
        { session },
      );

      await this.provisionCustomer(newUser._id as Types.ObjectId, session);
      await session.commitTransaction();

      const token = await this.generateToken({
        id: newUser._id,
        email: newUser.email,
      });

      this.logger.log(`Customer registered via Google: ${email}`);
      return {
        message: 'Welcome to Qlozet!',
        data: { user: sanitizeUser(newUser), token, is_new_user: true },
      };
    } catch (error) {
      await session.abortTransaction();
      this.logger.error(`Google sign-up failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException(
        'Could not complete sign-in. Please try again.',
      );
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate user by email and password (for local strategy)
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<UserDocument | null> {
    try {
      const user = await this.userModel
        .findOne({ email, status: 'active' })
        .select('+hashed_password')
        .populate('role');

      if (!user) {
        return null;
      }

      // A provider account has no password to validate against.
      if (!user.hashed_password) {
        return null;
      }

      const validPassword = await bcrypt.compare(
        password,
        user.hashed_password,
      );
      if (!validPassword) {
        return null;
      }
      return user;
    } catch (error) {
      this.logger.error(
        `User validation failed: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Record a successful sign-in on the user document.
   *
   * Deliberately not awaited: `last_login_at` is reporting data for the admin
   * console, and a write failure here must never turn a valid sign-in into an
   * error the person cannot get past. The rejection is caught and logged so it
   * can never surface as an unhandled rejection either.
   */
  private stampLastLogin(userId: unknown): void {
    void this.userModel
      .updateOne(
        { _id: userId as any },
        { $set: { last_login_at: new Date() } },
      )
      .exec()
      .then(
        () => undefined,
        (error: any) =>
          this.logger.warn(
            `Could not stamp last_login_at for ${String(userId)}: ${error?.message}`,
          ),
      );
  }

  /**
   * Generate JWT token for user
   */
  async generateToken(jwtPayload: JwtPayload): Promise<Tokens> {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.ACCESS_SECRET,
        expiresIn: '7d',
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);

    return {
      access_token: at,
      refresh_token: rt,
    };
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token: string): Promise<any> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      this.logger.error(`Token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Check if email exists
   */
  async checkEmailExists(email: string): Promise<boolean> {
    const user = await this.userModel.findOne({ email });
    return !!user;
  }

  /**
   * Check if phone number exists
   */
  async checkPhoneNumberExists(phoneNumber: string): Promise<boolean> {
    const user = await this.userModel.findOne({ phoneNumber });
    return !!user;
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<any> {
    const user = await this.userModel
      .findById(userId)
      .populate('role')
      .populate('business');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return sanitizeUser(user);
  }

  /**
   * Update user profile
   */
  async updateUserProfile(
    userId: string,
    updateData: Partial<User>,
  ): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: updateData }, { new: true })
      .populate('role')
      .populate('business');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return sanitizeUser(user);
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    { current_password, new_password }: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userModel
      .findById(userId)
      .select('+hashed_password');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.hashed_password) {
      // Nothing to change: this account has only ever signed in through a
      // provider. Setting a first password is a different flow from changing
      // one, and offering it here would let whoever holds the session add a
      // second way in without re-authenticating.
      throw new BadRequestException(
        'This account signs in with Google and has no password to change.',
      );
    }

    const validCurrentPassword = await bcrypt.compare(
      current_password,
      user.hashed_password,
    );
    if (!validCurrentPassword) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.hashed_password = await bcrypt.hash(new_password, 10);
    user.must_change_password = false;
    await user.save();
    // One email, one password: the linked shop / store account too.
    await this.syncLinkedPassword(user, user.hashed_password);

    // Send password updated email
    try {
      await this.mailService.sendPasswordUpdatedEmail(
        user.email,
        user.full_name,
      );
    } catch (error) {
      this.logger.error('Failed to send password updated email:', error);
    }

    return { message: 'Password updated successfully' };
  }

  // ─── Password-reset (code) tuning ──────────────────────────────────
  // A 6-digit code is only ~1M combinations, so these guardrails — short TTL,
  // hashed-at-rest, an attempt cap, and a resend cooldown — are what make it
  // safe. See requestPasswordReset / verifyResetCode / resetPassword below.
  private readonly RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly RESET_MAX_ATTEMPTS = 5; // wrong tries before the code dies
  private readonly RESET_RESEND_COOLDOWN_MS = 60 * 1000; // 1 min between sends
  private readonly RESET_GENERIC_MSG =
    'If an account exists for that email, a reset code has been sent';

  /**
   * Request a password-reset CODE (6-digit OTP) by email. Enumeration-safe:
   * always returns the same generic message whether or not the account exists,
   * and even if the email send fails. The code is stored hashed with a short
   * expiry, a zeroed attempt counter, and a resend-cooldown anchor.
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    // An email may hold a shopping and a store account sharing one password;
    // the code lives on the older one and the reset changes both. Same
    // order here and in assertResetCode.
    const user = await this.userModel
      .findOne({ email })
      .sort({ createdAt: 1, _id: 1 })
      .select('+password_reset_code');

    // Same response for a missing account — never reveal existence.
    if (!user) {
      return { message: this.RESET_GENERIC_MSG };
    }

    // Resend cooldown: if a code was just issued, don't mint/send another (but
    // still return the generic message so timing doesn't leak existence).
    const lastSent = user.password_reset_code?.last_sent_at;
    if (
      lastSent &&
      Date.now() - new Date(lastSent).getTime() < this.RESET_RESEND_COOLDOWN_MS
    ) {
      return { message: this.RESET_GENERIC_MSG };
    }

    const code = generateOtp(); // 6-digit
    user.password_reset_code = {
      pin: createHash(code), // hashed at rest — never store the raw code
      expire_at: new Date(Date.now() + this.RESET_CODE_TTL_MS),
      attempts: 0,
      last_sent_at: new Date(),
    };
    await user.save();

    // Best-effort send — a mail failure must NOT change the response (else a
    // 500-vs-200 difference would leak which emails exist).
    try {
      await this.mailService.sendResetCodeEmail(
        user.email,
        user.full_name,
        code,
      );
    } catch (error) {
      this.logger.error('Failed to send reset code email:', error);
    }

    return { message: this.RESET_GENERIC_MSG };
  }

  /**
   * Shared code check for verify + reset. Validates existence, expiry, the
   * attempt cap, and the hashed code. On a wrong code it increments the attempt
   * counter (locking the code once the cap is hit); on success it does nothing
   * to the counter so a correct verify→reset pair costs zero attempts. Returns
   * the (validated) user document so the caller can proceed. Throws a single
   * generic error for every invalid case — no enumeration.
   */
  private async assertResetCode(email: string, code: string) {
    const invalid = new BadRequestException('Invalid or expired reset code');

    const user = await this.userModel
      .findOne({ email })
      .sort({ createdAt: 1, _id: 1 })
      .select('+password_reset_code +hashed_password');

    const rc = user?.password_reset_code;
    if (!user || !rc?.pin || !rc?.expire_at) throw invalid;

    // Expired → clear it and fail.
    if (new Date(rc.expire_at).getTime() <= Date.now()) {
      user.password_reset_code = undefined;
      await user.save();
      throw invalid;
    }

    // Attempt cap reached → burn the code so it can't be brute-forced further.
    if ((rc.attempts ?? 0) >= this.RESET_MAX_ATTEMPTS) {
      user.password_reset_code = undefined;
      await user.save();
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new reset code.',
      );
    }

    // Wrong code → count the attempt and fail.
    if (createHash(code) !== rc.pin) {
      user.password_reset_code = {
        pin: rc.pin,
        expire_at: rc.expire_at,
        attempts: (rc.attempts ?? 0) + 1,
        last_sent_at: rc.last_sent_at,
      };
      await user.save();
      throw invalid;
    }

    return user;
  }

  /**
   * Verify a reset code WITHOUT consuming it — lets the web app gate the
   * "set new password" screen. A correct code does not spend an attempt.
   */
  async verifyResetCode(
    email: string,
    code: string,
  ): Promise<{ valid: boolean; message: string }> {
    await this.assertResetCode(email, code);
    return { valid: true, message: 'Code verified' };
  }

  /**
   * Reset the password using the emailed code. Re-validates the code (this is
   * the authoritative single-use consumer), sets the new password, and clears
   * the code so it can never be reused.
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.assertResetCode(email, code);

    user.hashed_password = await bcrypt.hash(newPassword, 10);
    user.password_reset_code = undefined; // single-use: consume it
    // They chose their own password now: no more forced change, and the
    // owner's "Resend invite" can no longer overwrite it.
    user.must_change_password = false;
    await user.save();
    // One email, one password: the linked shop / store account too.
    await this.syncLinkedPassword(user, user.hashed_password);

    try {
      await this.mailService.sendPasswordResetSuccessEmail(
        user.email,
        user.full_name,
      );
    } catch (error) {
      this.logger.error('Failed to send password reset success email:', error);
    }

    return { message: 'Password reset successfully' };
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    userId: string,
    preferences: {
      bodyFit?: string[];
      wearsPreference?: string;
      aestheticPreferences?: string[];
      emailPreferences?: string[];
      isEmailPreferenceSelected?: boolean;
    },
  ): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: preferences }, { new: true })
      .populate('role')
      .populate('business');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return sanitizeUser(user);
  }

  /**
   * Add to wishlist
   */
  async addToWishlist(
    userId: string,
    productId: string,
  ): Promise<{ message: string }> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Check if already in wishlist
    if (user.wishlist?.includes(new Types.ObjectId(productId))) {
      throw new BadRequestException('Product already in wishlist');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { wishlist: productId },
    });

    return { message: 'Product added to wishlist' };
  }

  /**
   * Remove from wishlist
   */
  async removeFromWishlist(
    userId: string,
    productId: string,
  ): Promise<{ message: string }> {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { wishlist: productId },
    });

    return { message: 'Product removed from wishlist' };
  }

  /**
   * Get user's wishlist
   */
  async getWishlist(userId: string): Promise<any> {
    const user = await this.userModel
      .findById(userId)
      .populate('wishlist')
      .select('wishlist');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return user.wishlist;
  }
}
