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
import {
  UserDocument,
  User,
  UserType,
  Business,
  BusinessDocument,
  Role,
  RoleDocument,
} from '../ums/schemas';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { CustomerRegistrationDto, VendorRegisterDto } from './dto';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../ums/schemas/role.schema';
import { JwtPayload, Tokens } from 'src/common/types';
import { MailService } from '../notifications/mail/mail.service';
import { UserService } from '../ums/services/users.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly userService: UserService,
  ) {}

  /**
   * Register a new vendor
   */
  async registerVendor(data: VendorRegisterDto) {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const {
        personalName,
        personalPhoneNumber,
        personalEmail,
        businessName,
        businessEmail,
        businessPhoneNumber,
        businessAddress,
        password,
        businessLogoUrl,
        coverImageUrl,
        displayPictureUrl,
        ...businessData
      } = data;

      // Check if business already exists
      const existingBusiness = await this.businessModel.findOne({
        $or: [{ businessEmail }, { businessPhoneNumber }],
      });
      if (existingBusiness) {
        throw new ConflictException(
          'A business with the provided email or phone number already exists.',
        );
      }

      // Check if user already exists
      const r = await this.userService.findByPhoneNumber(personalPhoneNumber);
      const existingUser = await this.userModel.findOne({
        $or: [{ email: personalEmail }, { phoneNumber: personalPhoneNumber }],
      });
      if (existingUser) {
        throw new ConflictException(
          'A user with this email or phone number already exists.',
        );
      }

      // Find vendor role using enum
      const vendorRole = await this.roleModel.findOne({
        name: UserRole.VENDOR,
      });
      if (!vendorRole) {
        throw new BadRequestException('Vendor role not found.');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Generate email verification token
      const emailVerificationToken = this.generateVerificationToken();

      // Create the Vendor User (Business Owner) first
      const vendorUser = new this.userModel({
        fullName: personalName,
        email: personalEmail,
        phoneNumber: personalPhoneNumber,
        hashedPassword,
        role: vendorRole._id,
        type: UserType.VENDOR,
        emailVerified: false,
        emailVerificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        status: 'active',
        profilePicture:
          displayPictureUrl ||
          'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQB2J8Tc056dMI-wNe0vmFtByW-ySbA3bY3nQ&s',
        lastVerificationEmailSent: new Date(),
        verificationEmailAttempts: 1,
      });

      await vendorUser.save({ session });

      // Create Business with vendor reference
      const business = new this.businessModel({
        businessName,
        businessEmail,
        businessPhoneNumber,
        businessAddress,
        personalName,
        personalPhoneNumber,
        displayPictureUrl: displayPictureUrl ?? '',
        businessLogoUrl: businessLogoUrl ?? '',
        coverImageUrl: coverImageUrl ?? '',
        vendor: vendorUser._id as Types.ObjectId,
        createdBy: vendorUser._id as Types.ObjectId,
        emailVerified: false,
        ...businessData,
      });

      await business.save({ session });

      // Update vendor user with business reference
      vendorUser.business = business._id as Types.ObjectId;
      await vendorUser.save({ session });

      await session.commitTransaction();
      const token = await this.generateToken({
        id: vendorUser._id,
        role: UserRole.VENDOR,
        email: vendorUser.email,
        type: UserType.VENDOR,
      });
      await this.userModel.findByIdAndUpdate(vendorUser._id, {
        refreshToken: token.refreshToken,
      });
      // Send verification email only initially
      await this.sendVerificationEmail(vendorUser, business);

      this.logger.log(`✅ Vendor registered successfully: ${businessName}`);

      return {
        data: {
          business,
          user: this.sanitizeUser(vendorUser),
        },
        message:
          'Vendor registered successfully. Please check your email to verify your account.',
      };
    } catch (error) {
      await session.abortTransaction();
      this.logger.error('❌ Vendor registration failed', error.stack);

      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Vendor registration failed. Please try again.',
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
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const { fullName, email, phoneNumber, password, dob, ...customerData } =
        data;

      // Check if user already exists
      const existingUser = await this.userModel.findOne({
        $or: [{ email }, { phoneNumber }],
      });
      if (existingUser) {
        throw new ConflictException('Email or phone number already in use');
      }

      // Find customer role using enum
      const role = await this.roleModel.findOne({ name: UserRole.CUSTOMER });
      if (!role) {
        throw new BadRequestException('Customer role not found');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Generate email verification token
      const emailVerificationToken = this.generateVerificationToken();
      // Create new customer
      const newUser = new this.userModel({
        fullName,
        email,
        phoneNumber,
        hashedPassword,
        role: role._id,
        type: UserType.CUSTOMER,
        emailVerified: false,
        emailVerificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        status: 'active',
        dob: dob ? new Date(dob) : undefined,
        lastVerificationEmailSent: new Date(),
        verificationEmailAttempts: 1,
        ...customerData,
      });

      await newUser.save({ session });
      await session.commitTransaction();

      // Send verification email only initially
      await this.sendVerificationEmail(newUser);

      this.logger.log(`Customer registered successfully: ${email}`);

      return {
        data: {
          user: this.sanitizeUser(newUser),
        },
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
  private async sendVerificationEmail(
    user: UserDocument,
    business?: BusinessDocument,
  ) {
    try {
      const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${user.emailVerificationToken}&type=${user.type}`;

      await this.mailService.sendVerificationEmail(
        user.email,
        user.fullName,
        verificationLink,
        user.emailVerificationToken as string,
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
          user.fullName,
          business.businessName,
        );

        // Update welcome email tracking
        await this.userModel.findByIdAndUpdate(user._id, {
          lastWelcomeEmailSent: new Date(),
        });

        this.logger.log(`Vendor welcome email sent to: ${user.email}`);
      } else if (user.type === UserType.CUSTOMER) {
        await this.mailService.sendCustomerWelcomeEmail(
          user.email,
          user.fullName,
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
  }

  /**
   * Generate email verification token
   */
  private generateVerificationToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<{
    message: string;
    userType: UserType;
    requiresProfileCompletion?: boolean;
  }> {
    try {
      const user = await this.userModel.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() },
      });

      if (!user) {
        throw new BadRequestException('Invalid or expired verification token');
      }

      let business;

      // If user is a vendor, get business details
      if (user.type === UserType.VENDOR && user.business) {
        business = await this.businessModel.findById(user.business);
      }

      // Update user email verification status
      user.emailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      user.status = 'active';
      user.emailVerifiedAt = new Date();

      await user.save();

      // If user is a vendor, also update business email verification
      if (user.type === UserType.VENDOR && user.business) {
        await this.businessModel.findByIdAndUpdate(user.business, {
          emailVerified: true,
        });
      }

      // Send welcome email AFTER successful verification
      await this.sendWelcomeEmail(user, business);

      this.logger.log(`Email verified successfully for: ${user.email}`);

      return {
        message: 'Email verified successfully! Welcome to our platform.',
        userType: user.type,
        requiresProfileCompletion: user.type === UserType.VENDOR,
      };
    } catch (error) {
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
      if (user.emailVerified) {
        throw new BadRequestException('Email is already verified.');
      }
      const now = new Date();
      if (
        user.emailVerificationExpires &&
        user.emailVerificationExpires > now
      ) {
        // Token is still valid, check if we can resend
        const lastEmailSent = user.lastWelcomeEmailSent?.getTime();
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

      let attempts = user.verificationEmailAttempts || 0;
      const maxAttempts = 5;
      if (attempts && attempts >= maxAttempts) {
        throw new BadRequestException(
          'Maximum verification email attempts reached. Please contact support.',
        );
      }

      // Generate new token if expired or about to expire
      if (
        !user.emailVerificationExpires ||
        user.emailVerificationExpires <= new Date(Date.now() + 60 * 60 * 1000)
      ) {
        user.emailVerificationToken = this.generateVerificationToken();
        user.emailVerificationExpires = new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ); // 24 hours
      }

      // Update resend tracking
      user.lastVerificationEmailSent = new Date();
      attempts += 1;

      await user.save();

      let business;
      if (user.type === UserType.VENDOR) {
        business = await this.businessModel.findOne({ vendor: user._id });
        await this.sendVerificationEmail(user, business);
      } else {
        await this.sendVerificationEmail(user);
      }

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
    emailVerifiedAt?: Date;
  }> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      verified: user.emailVerified,
      userType: user.type,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
    };
  }

  /**
   * Login vendor
   */
  async loginVendor(email: string, password: string) {
    try {
      const vendor = await this.userModel
        .findOne({ email, type: UserType.VENDOR })
        .select('+hashedPassword')
        .populate('role')
        .populate('business');

      if (!vendor) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if email is verified
      if (!vendor.emailVerified) {
        const now = new Date();
        if (
          vendor.emailVerificationExpires &&
          vendor.emailVerificationExpires < now
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
        vendor.hashedPassword,
      );
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const token = await this.generateToken({
        id: vendor._id,
        role: UserRole.VENDOR,
        email: vendor.email,
        type: UserType.VENDOR,
      });
      const hashedRt = await bcrypt.hash(token.refreshToken, 10);
      await this.userModel.findByIdAndUpdate(vendor._id, {
        refreshToken: hashedRt,
      });
      return {
        message: 'Login successful. Welcome back!',
        data: {
          user: this.sanitizeUser(vendor),
          token,
        },
      };
    } catch (error) {
      this.logger.error(`Vendor login failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(userId: string, refreshToken: string): Promise<Tokens> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }
    const rtMatches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!rtMatches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const role = await this.roleModel.findById(user.role);
    const jwtPayload: JwtPayload = {
      id: user._id,
      email: user.email,
      role: role?.name,
      type: user.type,
    };

    const tokens = await this.generateToken(jwtPayload);

    const hashedRt = await bcrypt.hash(tokens.refreshToken, 10);
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
        .select('+hashedPassword')
        .populate('role');

      if (!user) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Check if email is verified
      if (!user.emailVerified) {
        const now = new Date();
        if (
          user.emailVerificationExpires &&
          user.emailVerificationExpires < now
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

      const validPassword = await bcrypt.compare(password, user.hashedPassword);
      if (!validPassword) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const token = await this.generateToken({
        id: user._id,
        role: UserRole.CUSTOMER,
        email: user.email,
        type: UserType.CUSTOMER,
      });

      return {
        message: 'Login successful. Welcome back!',
        data: {
          user: this.sanitizeUser(user),
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
        .select('+hashedPassword')
        .populate('role');

      if (!user) {
        return null;
      }

      const validPassword = await bcrypt.compare(password, user.hashedPassword);
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
   * Generate JWT token for user
   */
  async generateToken(jwtPayload: JwtPayload): Promise<Tokens> {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.ACCESS_SECRET,
        expiresIn: '1h',
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);

    return {
      accessToken: at,
      refreshToken: rt,
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

    return this.sanitizeUser(user);
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

    return this.sanitizeUser(user);
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.userModel
      .findById(userId)
      .select('+hashedPassword');

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const validCurrentPassword = await bcrypt.compare(
      currentPassword,
      user.hashedPassword,
    );
    if (!validCurrentPassword) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Send password updated email
    try {
      await this.mailService.sendPasswordUpdatedEmail(
        user.email,
        user.fullName,
      );
    } catch (error) {
      this.logger.error('Failed to send password updated email:', error);
    }

    return { message: 'Password updated successfully' };
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.userModel.findOne({ email });

    if (!user) {
      // Don't reveal whether email exists or not for security
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const resetToken = this.generateVerificationToken();

    // Use passwordResetCode field from schema
    user.passwordResetCode = {
      pin: resetToken,
      expireAt: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour
    };

    await user.save();

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await this.mailService.sendResetEmail(
        user.email,
        user.fullName,
        resetLink,
      );
    } catch (error) {
      this.logger.error('Failed to send reset email:', error);
      throw new InternalServerErrorException('Failed to send reset email');
    }

    return { message: 'If the email exists, a reset link has been sent' };
  }

  /**
   * Reset password with token
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.userModel.findOne({
      'passwordResetCode.pin': token,
      'passwordResetCode.expireAt': { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    user.hashedPassword = await bcrypt.hash(newPassword, 10);
    user.passwordResetCode = undefined;

    await user.save();

    // Send password reset success email
    try {
      await this.mailService.sendPasswordResetSuccessEmail(
        user.email,
        user.fullName,
      );
    } catch (error) {
      this.logger.error('Failed to send password reset success email:', error);
    }

    return { message: 'Password reset successfully' };
  }

  /**
   * Sanitize user object - remove sensitive fields
   */
  private sanitizeUser(user: UserDocument): any {
    const userObj = user.toObject();

    // Remove sensitive fields
    delete userObj.hashedPassword;
    delete userObj.emailVerificationToken;
    delete userObj.emailVerificationExpires;
    delete userObj.refreshToken;
    delete userObj.verification;
    delete userObj.passwordResetCode;

    return userObj;
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

    return this.sanitizeUser(user);
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
