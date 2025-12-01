import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { UserDocument, User, UserType } from '../schemas';
import { MailService } from '../../notifications/mail/mail.service';
import { Address, AddressDocument } from '../schemas/address.schema';
import { AddressDto } from '../dto/address.dto';
import { LogisticsService } from 'src/modules/logistics/logistics.service';
import { Utils } from 'src/common/utils/pagination';
import { AddMeasurementSetDto } from 'src/modules/measurement/dto/user-measurement.dto';
import { UpdateUserDto } from '../dto/users.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
    private readonly mailService: MailService,
    private readonly logisticService: LogisticsService,
  ) {}

  async fetchCustomers(
    page = 1,
    size = 10,
    filters?: {
      search?: string;
      state?: string;
      city?: string;
      gender?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
  ) {
    const query: any = { type: UserType.CUSTOMER };

    if (filters?.search) {
      const s = filters.search.trim();
      query.$or = [
        { first_name: new RegExp(s, 'i') },
        { last_name: new RegExp(s, 'i') },
        { email: new RegExp(s, 'i') },
        { phone: new RegExp(s, 'i') },
      ];
    }

    if (filters?.state) {
      query['address.state'] = new RegExp(`^${filters.state}$`, 'i');
    }

    if (filters?.city) {
      query['address.city'] = new RegExp(`^${filters.city}$`, 'i');
    }

    if (filters?.gender) {
      query.gender = filters.gender;
    }

    if (filters?.status) {
      query.status = filters.status;
    }

    if (filters?.startDate || filters?.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        query.createdAt.$lte = new Date(filters.endDate);
      }
    }

    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.userModel.find(query).skip(skip).limit(take).sort({ createdAt: -1 }),
      this.userModel.countDocuments(query),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

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
  async updateProfile(userId: string, dto: UpdateUserDto) {
    const data = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: dto },
      { new: true },
    );
    return data?.toJSON();
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
  async upsertUserAddress(user: UserDocument, dto: AddressDto) {
    try {
      const validated = await this.logisticService.validateAddress({
        ...dto,
        name: dto.address,
        email: user.email,
        phone: dto?.phone_number ?? user.phone_number,
      });

      const existing = await this.addressModel.findOne({ customer: user.id });

      if (existing) {
        Object.assign(existing, {
          ...dto,
          address: validated.formatted_address,
          address_code: validated.address_code,
        });

        await existing.save();
        return existing.toJSON();
      }

      // Create a new address
      const newAddress = new this.addressModel({
        customer: user.id,
        ...(!dto.full_name && { full_name: user.full_name }),
        ...(!dto.phone_number && { phone_number: user.phone_number }),
        ...dto,
        address: validated.formatted_address,
        address_code: validated.address_code,
      });

      return (await newAddress.save()).toJSON();
    } catch (err) {
      console.error('Upsert user address failed:', err.message);

      throw new HttpException(
        err?.message || err?.response?.data || 'Unable to update address',
        err?.response?.status || 500,
      );
    }
  }

  async getUserAddress(userId: Types.ObjectId) {
    const address = await this.addressModel.findOne({ user: userId });
    if (!address) throw new NotFoundException('No address found for this user');
    return address;
  }

  async getActiveMeasurementSet(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('full_name email phone_number measurementSets');
    if (!user) throw new NotFoundException('User not found');

    if (!user.measurementSets || user.measurementSets.length === 0) {
      throw new BadRequestException('User has no measurement sets');
    }

    const activeSet = user.measurementSets.find((set) => set.active);

    if (!activeSet) {
      throw new BadRequestException('No active measurement set found');
    }

    return {
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      ...activeSet,
    };
  }
  async setActiveMeasurementSet(userId: string, setName: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.measurementSets || user.measurementSets.length === 0)
      throw new BadRequestException('User has no measurement sets');

    let found = false;

    user.measurementSets.forEach((set) => {
      if (set.name === setName) {
        set.active = true;
        found = true;
      } else {
        set.active = false;
      }
    });

    if (!found)
      throw new BadRequestException(`Measurement set "${setName}" not found`);

    await user.save();

    return user.measurementSets.find((s) => s.active);
  }
  async addMeasurementSet(userId: string, dto: AddMeasurementSetDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    user.measurementSets = user.measurementSets || [];
    if (user.measurementSets.some((set) => set.name === dto.name)) {
      throw new BadRequestException(
        `Measurement set name "${dto.name}" already exists`,
      );
    }
    const isFirstSet =
      !user.measurementSets || user.measurementSets.length === 0;

    const newSet = {
      name: dto.name || `set-${Date.now()}`,
      createdAt: new Date(),
      active: isFirstSet,
      unit: dto.unit,
      measurements: { ...dto.measurements },
    };

    user.measurementSets = user.measurementSets || [];
    user.measurementSets.push(newSet);

    await user.save();
    return newSet;
  }
}
