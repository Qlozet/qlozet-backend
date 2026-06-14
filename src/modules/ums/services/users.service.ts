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
import { AddMeasurementSetDto, UpdateMeasurementSetDto } from 'src/modules/measurement/dto/user-measurement.dto';
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
      // .populate('role')
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
    } catch (error: any) {
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

  async deleteUser(userId: string) {
    return this.userModel.findByIdAndDelete(userId);
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
    } catch (error: any) {
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
  // ════════════════════════════════════════════════════════════════
  //  ADDRESS BOOK
  // ════════════════════════════════════════════════════════════════

  private static readonly MAX_ADDRESSES = 5;

  private validateObjectId(id: string, label = 'ID') {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label}: ${id}`);
    }
  }

  /**
   * Add a new address to the customer's address book.
   * First address is auto-set as default. Max 5 per customer.
   */
  async addAddress(user: UserDocument, dto: AddressDto) {
    const count = await this.addressModel.countDocuments({ customer: user.id });
    if (count >= UserService.MAX_ADDRESSES) {
      throw new BadRequestException(
        `You can save up to ${UserService.MAX_ADDRESSES} addresses. Please delete one first.`,
      );
    }

    // Validate via ShipBubble
    const validated = await this.logisticService.validateAddress({
      ...dto,
      name: dto.full_name || user.full_name,
      email: user.email,
      phone: dto.phone_number ?? user.phone_number,
      latitude: dto.latitude ?? 0,
      longitude: dto.longitude ?? 0,
    });

    const isFirst = count === 0;
    const shouldBeDefault = dto.is_default || isFirst;

    // If setting as default, unset any existing default
    if (shouldBeDefault) {
      await this.addressModel.updateMany(
        { customer: user.id, is_default: true },
        { $set: { is_default: false } },
      );
    }

    const newAddress = new this.addressModel({
      customer: user.id,
      full_name: dto.full_name || user.full_name,
      phone_number: dto.phone_number || user.phone_number,
      ...dto,
      address: validated.formatted_address,
      address_code: validated.address_code,
      is_default: shouldBeDefault,
      label: dto.label || '',
    });

    return (await newAddress.save()).toJSON();
  }

  /**
   * List all addresses for a customer (default first).
   */
  async listAddresses(userId: string | Types.ObjectId) {
    return this.addressModel
      .find({ customer: userId })
      .sort({ is_default: -1, createdAt: -1 })
      .lean();
  }

  /**
   * Get the customer's default address.
   */
  async getDefaultAddress(userId: string | Types.ObjectId) {
    const address = await this.addressModel.findOne({
      customer: userId,
      is_default: true,
    });
    if (!address) {
      // Fallback: get the most recent address
      const fallback = await this.addressModel
        .findOne({ customer: userId })
        .sort({ createdAt: -1 });
      if (!fallback) return null;
      // Auto-set it as default
      fallback.is_default = true;
      await fallback.save();
      return fallback;
    }
    return address;
  }

  /**
   * Get a specific address by ID (verify ownership).
   */
  async getAddressById(userId: string | Types.ObjectId, addressId: string) {
    this.validateObjectId(addressId, 'address ID');
    const address = await this.addressModel.findOne({
      _id: addressId,
      customer: userId,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }

  /**
   * Update an existing address. Re-validates via ShipBubble if address fields changed.
   */
  async updateAddress(userId: string | Types.ObjectId, addressId: string, dto: any) {
    this.validateObjectId(addressId, 'address ID');
    const address = await this.addressModel.findOne({
      _id: addressId,
      customer: userId,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Check if any physical address fields changed (require re-validation)
    const addressFields = ['address', 'city', 'state', 'country', 'postal_code'];
    const needsRevalidation = addressFields.some(
      (field) => dto[field] !== undefined && dto[field] !== address[field],
    );

    if (needsRevalidation) {
      const mergedAddress = {
        address: dto.address ?? address.address,
        city: dto.city ?? address.city,
        state: dto.state ?? address.state,
        country: dto.country ?? address.country,
        postal_code: dto.postal_code ?? address.postal_code,
      };

      const validated = await this.logisticService.validateAddress({
        ...mergedAddress,
        name: dto.full_name || address.full_name,
        email: '',
        phone: dto.phone_number || address.phone_number,
        latitude: dto.latitude ?? 0,
        longitude: dto.longitude ?? 0,
      });

      dto.address = validated.formatted_address;
      dto.address_code = validated.address_code;
    }

    // Apply updates
    Object.keys(dto).forEach((key) => {
      if (dto[key] !== undefined) {
        address[key] = dto[key];
      }
    });

    await address.save();
    return address.toJSON();
  }

  /**
   * Delete an address. Cannot delete the default if other addresses exist
   * (must set a new default first).
   */
  async deleteAddress(userId: string | Types.ObjectId, addressId: string) {
    this.validateObjectId(addressId, 'address ID');
    const address = await this.addressModel.findOne({
      _id: addressId,
      customer: userId,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    const totalCount = await this.addressModel.countDocuments({ customer: userId });

    if (address.is_default && totalCount > 1) {
      // Auto-reassign default to the next most recent address
      const next = await this.addressModel
        .findOne({ customer: userId, _id: { $ne: addressId } })
        .sort({ createdAt: -1 });
      if (next) {
        next.is_default = true;
        await next.save();
      }
    }

    await this.addressModel.deleteOne({ _id: addressId });
    return { message: 'Address deleted successfully' };
  }

  /**
   * Set a specific address as the default.
   */
  async setDefaultAddress(userId: string | Types.ObjectId, addressId: string) {
    this.validateObjectId(addressId, 'address ID');
    const address = await this.addressModel.findOne({
      _id: addressId,
      customer: userId,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    // Unset all defaults for this customer
    await this.addressModel.updateMany(
      { customer: userId, is_default: true },
      { $set: { is_default: false } },
    );

    address.is_default = true;
    await address.save();
    return address.toJSON();
  }

  // ── Backward compatibility (deprecated) ──────────────────────

  /** @deprecated Use addAddress / updateAddress instead */
  async upsertUserAddress(user: UserDocument, dto: AddressDto) {
    try {
      const existing = await this.addressModel.findOne({ customer: user.id });
      if (existing) {
        return this.updateAddress(user.id, (existing._id as Types.ObjectId).toString(), dto);
      }
      return this.addAddress(user, dto);
    } catch (err: any) {
      throw new HttpException(
        err?.message || err?.response?.data || 'Unable to update address',
        err?.response?.status || 500,
      );
    }
  }

  /** @deprecated Use getDefaultAddress instead */
  async getUserAddress(userId: Types.ObjectId) {
    const address = await this.getDefaultAddress(userId);
    if (!address) throw new NotFoundException('No address found for this user');
    return address;
  }

  async getActiveMeasurementSet(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('full_name email phone_number measurementSets')
      .lean();
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

  async updateMeasurementSet(
    userId: string,
    setName: string,
    dto: UpdateMeasurementSetDto,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.measurementSets || user.measurementSets.length === 0) {
      throw new BadRequestException('User has no measurement sets');
    }

    const set = user.measurementSets.find((s) => s.name === setName);
    if (!set) {
      throw new NotFoundException(`Measurement set "${setName}" not found`);
    }

    if (dto.unit) set.unit = dto.unit;
    if (dto.measurements) {
      // measurements is a Mongoose Map — use .set() for each key
      for (const [key, value] of Object.entries(dto.measurements)) {
        (set.measurements as any).set(key, value);
      }
    }

    await user.save();
    return set;
  }

  async getAllMeasurementSets(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('full_name email phone_number measurementSets')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    return {
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      total: user.measurementSets?.length ?? 0,
      sets: user.measurementSets ?? [],
    };
  }

  async getMeasurementSetByName(userId: string, setName: string) {
    const user = await this.userModel
      .findById(userId)
      .select('full_name email phone_number measurementSets')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const set = user.measurementSets?.find((s) => s.name === setName);
    if (!set)
      throw new NotFoundException(`Measurement set "${setName}" not found`);

    return {
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      ...set,
    };
  }

  async deleteMeasurementSet(userId: string, setName: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.measurementSets || user.measurementSets.length === 0)
      throw new BadRequestException('User has no measurement sets');

    const setIndex = user.measurementSets.findIndex((s) => s.name === setName);
    if (setIndex === -1)
      throw new NotFoundException(`Measurement set "${setName}" not found`);

    const wasActive = user.measurementSets[setIndex].active;
    user.measurementSets.splice(setIndex, 1);

    // If the deleted set was active and there are remaining sets, activate the first one
    if (wasActive && user.measurementSets.length > 0) {
      user.measurementSets[0].active = true;
    }

    await user.save();

    return {
      message: `Measurement set "${setName}" deleted successfully`,
      remaining: user.measurementSets.length,
    };
  }
}
