import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';
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
  createHash,
  generateOtp,
} from 'src/common/utils/generateString';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

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
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Register a new vendor
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

    // Only check for conflicting businesses if email or phone were provided.
    // When these optional fields are undefined, MongoDB treats { field: undefined }
    // as { field: null }, which falsely matches any doc missing that field.
    const businessOrConditions: Record<string, string>[] = [];
    if (business_email) businessOrConditions.push({ business_email });
    if (business_phone_number)
      businessOrConditions.push({ business_phone_number });

    if (businessOrConditions.length > 0) {
      const existingBusiness = await this.businessModel.findOne({
        $or: businessOrConditions,
      });
      if (existingBusiness) {
        const field =
          business_email &&
          existingBusiness.business_email === business_email
            ? 'email'
            : 'phone number';
        throw new ConflictException(
          `A business with this ${field} already exists.`,
        );
      }
    }

    const existingUser = await this.userModel.findOne({
      $or: [{ email: personal_email }, { phone_number: personal_phone_number }],
    });
    if (existingUser) {
      const field =
        existingUser.email === personal_email ? 'email' : 'phone number';
      throw new ConflictException(
        `A user with this ${field} already exists.`,
      );
    }

    const ownerRole = await this.roleModel.findOne({ name: VendorRole.OWNER });
    if (!ownerRole) throw new BadRequestException('Vendor role not found.');

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const hashed_password = await bcrypt.hash(password, 10);
      const otp = generateOtp();
      const email_verification_token = createHash(otp);

      const [vendorUser] = await this.userModel.create(
        [
          {
            full_name: personal_name,
            email: personal_email,
            phone_number: personal_phone_number,
            hashed_password,
            role: ownerRole._id,
            type: UserType.VENDOR,
            email_verified: false,
            email_verification_token,
            email_verification_expires: new Date(
              Date.now() + 24 * 60 * 60 * 1000,
            ),
            status: 'active',
            profilePicture: display_picture_url || '',
            last_verification_email_sent: new Date(),
          },
        ],
        { session },
      );

      const [business] = await this.businessModel.create(
        [
          {
            business_name,
            business_email,
            business_phone_number,
            display_picture_url: display_picture_url ?? '',
            business_logo_url: business_logo_url ?? '',
            cover_image_url: cover_image_url ?? '',
            created_by: {
              id: vendorUser._id,
              name: vendorUser.full_name,
              email: vendorUser.email,
            },
            ...businessData,
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
        [
          {
            business: business._id,
            balance: 0,
            currency: 'NGN',
          },
        ],
        { session },
      );

      await this.tokenModel.create(
        [
          {
            business: business._id,
            tokens: 250,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      const token = await this.generateToken({
        id: vendorUser._id,
        email: vendorUser.email,
      });

      await this.userModel.findByIdAndUpdate(vendorUser._id, {
        refreshToken: token.refresh_token,
        business: business._id,
      });

      await this.sendVerificationEmail(vendorUser, otp);

      return {
        data: {
          user: sanitizeUser(vendorUser),
          business: sanitizeBusiness(business),
        },
        message: 'Vendor registered successfully. Check email to verify.',
      };
    } catch (error) {
      await session.abortTransaction();
      console.error('❌ Vendor registration error:', error?.message || error);
      console.error('Stack:', error?.stack);
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
   * Register a new customer
   */
  async registerCustomer(data: CustomerRegistrationDto): Promise<{
    data: { user: any };
    message: string;
  }> {
    const { full_name, email, phone_number, password, dob, ...customerData } =
      data;

    const existingUser = await this.userModel.findOne({
      $or: [{ email }, { phone_number }],
    });
    if (existingUser)
      throw new ConflictException('Email or phone number already in use');

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
              Date.now() + 24 * 60 * 60 * 1000,
            ),
            status: 'active',
            dob: dob ? new Date(dob) : undefined,
            last_verification_email_sent: new Date(),
            ...customerData,
          },
        ],
        { session },
      );

      await this.walletModel.create(
        [
          {
            customer: newUser._id,
            balance: 0,
            currency: 'NGN',
          },
        ],
        { session },
      );

      await this.tokenModel.create(
        [
          {
            user: newUser._id,
            tokens: 100,
          },
        ],
        { session },
      );

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
   * Send verification email
   */
  private async sendVerificationEmail(user: UserDocument, code: string) {
    try {
      const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${user.email_verification_token}&type=${user.type}`;

      await this.mailService.sendVerificationEmail(
        user.email,
        user.full_name,
        verificationLink,
        code,
      );

      // Update email tracking fields
      await this.userModel.findByIdAndUpdate(user._id, {
        lastVerificationEmailSent: new Date(),
        $inc: { verificationEmailAttempts: 1 },
      });

      this.logger.log(`Verification email sent to ${user.type}: ${user.email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${user.email}:`,
        error,
      );
      // Don't throw error to avoid breaking registration flow
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
  async verifyEmail(code: string) {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const submittedHashed = code.length === 6 ? createHash(code) : code;

      const user = await this.userModel.findOne(
        {
          email_verification_token: submittedHashed,
          email_verification_expires: { $gt: new Date() },
        },
        null,
        { session },
      );

      if (!user) {
        throw new BadRequestException('Invalid or expired verification token');
      }

      Object.assign(user, {
        email_verified: true,
        email_verification_token: undefined,
        email_verification_expires: undefined,
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
      await session.abortTransaction();
      session.endSession();
      this.logger.error('Email verification failed:', error);
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    try {
      const user = await this.userModel.findOne({ email });

      if (!user) {
        throw new NotFoundException('User not found with this email address.');
      }

      // Check if email is already verified
      if (user.email_verified) {
        throw new BadRequestException('Email is already verified.');
      }
      const otp = generateOtp();
      const email_verification_token = createHash(otp);
      const now = new Date();
      if (
        user.email_verification_expires &&
        user.email_verification_expires > now
      ) {
        // Token is still valid, check if we can resend
        const lastEmailSent = user.last_welcome_email_sent?.getTime();
        const timeSinceLastSent =
          lastEmailSent && now.getTime() - lastEmailSent;
        const minResendInterval = 2 * 60 * 1000; // 2 minutes in milliseconds

        if (timeSinceLastSent && timeSinceLastSent < minResendInterval) {
          const waitTime = Math.ceil(
            (minResendInterval - timeSinceLastSent) / 1000 / 60,
          );
          throw new BadRequestException(
            `Please wait ${waitTime} minute(s) before requesting another verification email.`,
          );
        }
      }

      if (
        !user.email_verification_expires ||
        user.email_verification_expires <= new Date(Date.now() + 60 * 60 * 1000)
      ) {
        user.email_verification_token = email_verification_token;
        user.email_verification_expires = new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ); // 24 hours
      }

      // Update resend tracking
      user.last_verification_email_sent = new Date();

      await user.save();

      this.sendVerificationEmail(user, otp);

      this.logger.log(`Verification email resent to: ${email}`);

      return {
        message:
          'Verification email sent successfully. Please check your inbox.',
      };
    } catch (error) {
      this.logger.error(
        `Resend verification failed: ${error.message}`,
        error.stack,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to resend verification email. Please try again.',
      );
    }
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
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if email is verified
      if (!vendor.email_verified) {
        const now = new Date();
        if (
          vendor.email_verification_expires &&
          vendor.email_verification_expires < now
        ) {
          await this.resendVerificationEmail(vendor.email);
          return;
        }
        throw new UnauthorizedException(
          'Please verify your email address before logging in. Check your inbox for the verification link.',
        );
      }

      // Check if account is active
      if (vendor.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
      }

      const validPassword = await bcrypt.compare(
        password,
        vendor.hashed_password,
      );
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
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

      // Build businesses array
      const businesses = teamMemberships
        .filter((tm: any) => tm.business) // filter out orphaned records
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
      throw new UnauthorizedException(
        'You are not a member of this business.',
      );
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
   * Login customer
   */
  async loginCustomer(email: string, password: string) {
    try {
      const user = await this.userModel
        .findOne({ email, type: UserType.CUSTOMER })
        .select('+hashed_password');
      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if email is verified
      if (!user.email_verified) {
        const now = new Date();
        if (
          user.email_verification_expires &&
          user.email_verification_expires < now
        ) {
          await this.resendVerificationEmail(user.email);
          return;
        }
        throw new UnauthorizedException(
          'Please verify your email address before logging in. Check your inbox for the verification link.',
        );
      }

      // Check if account is active
      if (user.status !== 'active') {
        throw new UnauthorizedException(
          'Your account is not active. Please contact support.',
        );
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
      .updateOne({ _id: userId as any }, { $set: { last_login_at: new Date() } })
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
    const user = await this.userModel
      .findOne({ email })
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
      await this.mailService.sendResetCodeEmail(user.email, user.full_name, code);
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
    await user.save();

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
