import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UserDocument, User } from '../schemas';
import { MailService } from '../../notifications/mail/mail.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly mailService: MailService,
  ) {}

  /**
   * Find user by ID
   */
  async findById(userId: string): Promise<UserDocument> {
    const user = await this.userModel
      .findById(userId)
      .populate('role')
      .populate('business');

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email })
      .populate('role')
      .populate('business');
  }

  /**
   * Find user by phone number
   */
  async findByPhoneNumber(phoneNumber: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phoneNumber });
  }

  /**
   * Find user by email verification token
   */
  async findByEmailVerificationToken(token: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }
    return user;
  }

  /**
   * Check if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const user = await this.userModel.findOne({ email });
    return !!user;
  }

  /**
   * Check if phone number exists
   */
  async phoneNumberExists(phoneNumber: string): Promise<boolean> {
    const user = await this.userModel.findOne({ phoneNumber });
    return !!user;
  }

  /**
   * Create user
   */
  async create(userData: User): Promise<UserDocument> {
    try {
      const user = new this.userModel(userData);
      return await user.save();
    } catch (error) {
      this.logger.error('User creation failed', error.stack);
      if (error.code === 11000) {
        throw new ConflictException(
          'User with this email or phone already exists',
        );
      }
      throw new ConflictException('User creation failed');
    }
  }

  /**
   * Update user
   */
  async update(
    userId: string,
    updateData: Partial<User>,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: updateData }, { new: true })
      .populate('role')
      .populate('business');

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Update user with MongoDB operators
   */
  async updateWithOperators(
    userId: string,
    updateData: any,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, updateData, { new: true })
      .populate('role')
      .populate('business');

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Update email verification token
   */
  async updateVerificationToken(
    userId: string,
    token: string,
    expires: Date,
  ): Promise<UserDocument> {
    return this.updateWithOperators(userId, {
      $set: {
        emailVerificationToken: token,
        emailVerificationExpires: expires,
        lastVerificationEmailSent: new Date(),
      },
      $inc: { verificationEmailAttempts: 1 },
    });
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    profileData: Partial<User>,
  ): Promise<UserDocument> {
    return this.update(userId, profileData);
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    preferences: {
      bodyFit?: string[];
      wearsPreference?: string;
      aestheticPreferences?: string[];
      emailPreferences?: string[];
      isEmailPreferenceSelected?: boolean;
    },
  ) {
    // return this.update(userId, preferences);
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+hashed_password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const validCurrentPassword = await bcrypt.compare(
      currentPassword,
      user.hashed_password,
    );
    if (!validCurrentPassword) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.hashed_password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Send notification email
    try {
      await this.mailService.sendPasswordUpdatedEmail(
        user.email,
        user.full_name,
      );
    } catch (error) {
      this.logger.error('Failed to send password updated email:', error);
    }
  }

  /**
   * Set password reset token
   */
  async setPasswordResetToken(
    email: string,
    resetToken: string,
    expireAt: Date,
  ): Promise<UserDocument | null> {
    return this.userModel.findOneAndUpdate(
      { email },
      {
        $set: {
          passwordResetCode: {
            pin: resetToken,
            expireAt,
          },
        },
      },
      { new: true },
    );
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userModel.findOne({
      'passwordResetCode.pin': token,
      'passwordResetCode.expireAt': { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    user.hashed_password = await bcrypt.hash(newPassword, 10);
    user.password_reset_code = undefined;
    await user.save();

    // Send success email
    try {
      await this.mailService.sendPasswordResetSuccessEmail(
        user.email,
        user.full_name,
      );
    } catch (error) {
      this.logger.error('Failed to send password reset success email:', error);
    }
  }

  /**
   * Update email verification status
   */
  async verifyEmail(userId: string): Promise<UserDocument> {
    return this.update(userId, {
      email_verified: true,
      email_verification_token: undefined,
      email_verification_expires: undefined,
      status: 'active',
      email_verified_at: new Date(),
    });
  }

  /**
   * Validate user credentials
   */
  async validateCredentials(
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
      return validPassword ? user : null;
    } catch (error) {
      this.logger.error(
        `User validation failed: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Wishlist management
   */
  async addToWishlist(userId: string, productId: string): Promise<void> {
    const user = await this.findById(userId);

    if (user.wishlist?.includes(new Types.ObjectId(productId))) {
      throw new BadRequestException('Product already in wishlist');
    }

    await this.userModel.findByIdAndUpdate(userId, {
      $addToSet: { wishlist: productId },
    });
  }

  async removeFromWishlist(userId: string, productId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $pull: { wishlist: productId },
    });
  }

  async getWishlist(userId: string): Promise<any[]> {
    const user = await this.userModel
      .findById(userId)
      .populate('wishlist')
      .select('wishlist');

    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.wishlist || [];
  }

  /**
   * Sanitize user object - remove sensitive fields
   */
  sanitizeUser(user: UserDocument): any {
    const userObj = user.toObject();

    // Remove sensitive fields
    const sensitiveFields = [
      'hashed_password',
      'emailVerificationToken',
      'emailVerificationExpires',
      'refreshToken',
      'verification',
      'passwordResetCode',
    ];

    sensitiveFields.forEach((field) => {
      if (field in userObj) {
        delete userObj[field];
      }
    });

    return userObj;
  }

  /**
   * Get sanitized user by ID
   */
  async getSanitizedUser(userId: string): Promise<any> {
    const user = await this.findById(userId);
    return this.sanitizeUser(user);
  }
}
