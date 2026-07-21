import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Wallet, WalletDocument } from '../wallets/schema/wallet.schema';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import {
  Business,
  BusinessDocument,
  BusinessStatus,
} from './schemas/business.schema';
import { Utils } from 'src/common/utils/pagination';
import { CreateBusinessAddressDto } from './dto/create-address.dto';
import { LogisticsService } from '../logistics/logistics.service';
import { User, UserDocument } from '../ums/schemas';
import { PaginationQueryType } from 'src/common/types/pagination.type';
import { ProductService } from '../products/products.service';
import { Order, OrderDocument } from '../orders/schemas/orders.schema';
import {
  BusinessEarning,
  BusinessEarningDocument,
} from './schemas/business-earnings.schema';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { sanitizeBusiness } from 'src/common/utils/sanitization';

@Injectable()
export class BusinessService implements OnModuleInit {
  private readonly logger = new Logger(BusinessService.name);
  constructor(
    @InjectModel(Business.name)
    private businessModel: Model<BusinessDocument>,
    @InjectModel(Warehouse.name)
    private warehouseModel: Model<WarehouseDocument>,
    @InjectModel(PlatformSettings.name)
    private platformSettingsModel: Model<PlatformSettingsDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly logisticService: LogisticsService,
    private readonly productService: ProductService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(BusinessEarning.name)
    private businessEarningsModel: Model<BusinessEarningDocument>,
    @InjectModel(Wallet.name)
    private walletModel: Model<WalletDocument>,
  ) {}

  /**
   * On startup: drop old non-sparse unique index on business_email
   * and let Mongoose recreate it with sparse: true.
   * This is a one-time migration fix for E11000 duplicate key errors on null.
   */
  async onModuleInit() {
    // Fix business_email index
    try {
      await this.businessModel.collection.dropIndex('business_email_1');
      this.logger.log('✅ Dropped old business_email_1 index (non-sparse)');
    } catch (e: any) {
      if (e.codeName !== 'IndexNotFound') {
        this.logger.log(`ℹ️ business_email_1 index: ${e.message}`);
      }
    }
    try {
      await this.businessModel.ensureIndexes();
      this.logger.log('✅ Business indexes ensured (with sparse)');
    } catch (e: any) {
      this.logger.warn(`⚠️ ensureIndexes (business): ${e.message}`);
    }

    // Fix user phone_number index
    try {
      await this.userModel.collection.dropIndex('phone_number_1');
      this.logger.log('✅ Dropped old phone_number_1 index (non-sparse)');
    } catch (e: any) {
      if (e.codeName !== 'IndexNotFound') {
        this.logger.log(`ℹ️ phone_number_1 index: ${e.message}`);
      }
    }

    // Fix user username index — sparse only skips undefined, NOT null
    // So we must convert all null usernames to undefined (unset)
    try {
      const result = await this.userModel.collection.updateMany(
        { username: null },
        { $unset: { username: '' } },
      );
      if (result.modifiedCount > 0) {
        this.logger.log(`✅ Unset ${result.modifiedCount} null usernames`);
      }
    } catch (e: any) {
      this.logger.warn(`⚠️ Failed to unset null usernames: ${e.message}`);
    }

    try {
      await this.userModel.collection.dropIndex('username_1');
      this.logger.log('✅ Dropped old username_1 index');
    } catch (e: any) {
      if (e.codeName !== 'IndexNotFound') {
        this.logger.log(`ℹ️ username_1 index: ${e.message}`);
      }
    }

    try {
      await this.userModel.ensureIndexes();
      this.logger.log('✅ User indexes ensured (with sparse)');
    } catch (e: any) {
      this.logger.warn(`⚠️ ensureIndexes (user): ${e.message}`);
    }
  }

  async createWarehouse(
    dto: CreateWarehouseDto,
    business: string,
  ): Promise<Warehouse> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const businessId = new Types.ObjectId(business);
      const existingWithName = await this.warehouseModel
        .findOne({ business: businessId, name: dto.name })
        .session(session);

      if (existingWithName) {
        throw new BadRequestException(
          'Warehouse name must be unique for this business.',
        );
      }

      const existingCount = await this.warehouseModel
        .countDocuments({ business: businessId })
        .session(session);

      // ✅ Create new warehouse
      const warehouse = new this.warehouseModel({
        ...dto,
        ...(existingCount > 0 && { status: 'active' }),
        business: businessId,
      });

      await warehouse.save({ session });

      await session.commitTransaction();
      session.endSession();

      return warehouse.toJSON();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async findAllWarehouse(
    business: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);
    const filter = { business: new Types.ObjectId(business) };

    const [warehouses, totalCount] = await Promise.all([
      this.warehouseModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .populate('business', 'name email')
        .lean()
        .exec(),
      this.warehouseModel.countDocuments(filter),
    ]);

    // Return paginated result
    return Utils.getPagingData(
      { count: totalCount, rows: warehouses },
      page,
      size,
    );
  }

  async findOneWarehouse(id: string): Promise<Warehouse> {
    const warehouse = await this.warehouseModel
      .findById(id)
      .populate('business', 'name email')
      .exec();

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }

    return warehouse;
  }
  async activateWarehouse(id: string, business: string): Promise<Warehouse> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const businessId = new Types.ObjectId(business);
      const warehouseId = new Types.ObjectId(id);

      const warehouse = await this.warehouseModel
        .findOne({ _id: warehouseId, business: businessId })
        .session(session);

      if (!warehouse) {
        throw new NotFoundException('Warehouse not found for this business.');
      }

      // Deactivate all others
      await this.warehouseModel.updateMany(
        { business: businessId, _id: { $ne: warehouseId } },
        { $set: { status: 'inactive' } },
        { session },
      );

      // Activate this one
      warehouse.status = 'active';
      await warehouse.save({ session });

      await session.commitTransaction();
      session.endSession();

      return warehouse.toJSON();
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async updateWarehouse(
    id: string,
    dto: CreateWarehouseDto,
  ): Promise<Warehouse> {
    const warehouse = await this.warehouseModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }

    return warehouse;
  }

  async deleteWarehouse(id: string): Promise<{ message: string }> {
    const result = await this.warehouseModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }
    return { message: 'Warehouse deleted successfully' };
  }
  async findAllBusinesses(page: number = 1, size: number = 10) {
    const skip = (page - 1) * size;
    const limit = size;

    const result = await this.businessModel.aggregate([
      // -------------------- Vendor info --------------------
      {
        $lookup: {
          from: 'users',
          let: { vendorId: '$created_by.id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$vendorId'] } } },
            { $project: { _id: 1, full_name: 1, email: 1 } },
          ],
          as: 'vendor',
        },
      },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },

      // -------------------- Products --------------------
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'business',
          as: 'products',
        },
      },

      // -------------------- Orders --------------------
      {
        $lookup: {
          from: 'orders',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                status: 'completed',
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: '$items',
                          as: 'it',
                          cond: { $eq: ['$$it.business', '$$businessId'] },
                        },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: 'orders',
        },
      },

      // -------------------- Calculated fields --------------------
      {
        $addFields: {
          total_products: { $size: '$products' },
          total_orders: { $size: '$orders' },
          total_revenue: { $sum: '$orders.total' },
        },
      },

      // -------------------- Remove raw arrays --------------------
      {
        $project: {
          products: 0,
          orders: 0,
        },
      },

      // -------------------- Pagination --------------------
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const count = result[0]?.metadata[0]?.total || 0;
    const rows = result[0]?.data || [];

    return Utils.getPagingData({ count, rows }, page, size);
  }

  /**
   * Bulk fetch businesses by their IDs in a single query.
   * Used by the recommendation pipeline to avoid N+1 individual lookups.
   */
  async findBusinessesByIds(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!objectIds.length) return [];

    return this.businessModel
      .find({ _id: { $in: objectIds } })
      .lean()
      .exec();
  }

  /**
   * Public storefront: list active vendors with basic profile info.
   * Used by the customer shop for vendor carousels and listing pages.
   */
  async getPublicVendors(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [vendors, total] = await Promise.all([
      this.businessModel
        .find({ status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] } })
        .select(
          'business_name business_logo_url business_logo_svg_url cover_image_url ' +
          'theme_color description business_category business_address city state country ' +
          'website social_links total_items_sold ' +
          'success_rate is_featured year_founded accepts_external_fabric createdAt'
        )
        .skip(skip)
        .limit(limit)
        .lean(),
      this.businessModel.countDocuments({ status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] } }),
    ]);
    return { data: vendors, total, page, pages: Math.ceil(total / limit) };
  }

  /**
   * Public storefront: get a single vendor's profile with product count.
   * Excludes revenue, internal fields, and vendor user details.
   */
  async getPublicProfile(businessId: string) {
    if (!Types.ObjectId.isValid(businessId)) {
      throw new NotFoundException('Business not found');
    }

    const result = await this.businessModel.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(businessId),
          status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] },
        },
      },

      // Count active products
      {
        $lookup: {
          from: 'products',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$$businessId'] },
                status: 'active',
              },
            },
            { $count: 'count' },
          ],
          as: 'productCount',
        },
      },

      // Product ratings (for the computed vendor rating)
      {
        $lookup: {
          from: 'products',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$$businessId'] },
                status: 'active',
              },
            },
            { $project: { ratings: 1, average_rating: 1 } },
          ],
          as: 'ratingProducts',
        },
      },

      // Computed fields
      {
        $addFields: {
          total_products: {
            $ifNull: [{ $arrayElemAt: ['$productCount.count', 0] }, 0],
          },
          followers_count: { $size: { $ifNull: ['$followers', []] } },
          // Vendor rating aggregated from product ratings (the Business schema
          // has no own rating field — this is the source of truth).
          total_number_of_ratings: {
            $sum: {
              $map: {
                input: '$ratingProducts',
                as: 'p',
                in: { $size: { $ifNull: ['$$p.ratings', []] } },
              },
            },
          },
          cumulative_rating: {
            $cond: [
              { $gt: [{ $size: '$ratingProducts' }, 0] },
              { $avg: '$ratingProducts.average_rating' },
              0,
            ],
          },
        },
      },

      // Public projection — include storefront fields, exclude sensitive data
      {
        $project: {
          business_name: 1,
          business_logo_url: 1,
          business_logo_svg_url: 1,
          cover_image_url: 1,
          theme_color: 1,
          description: 1,
          business_category: 1,
          business_address: 1,
          city: 1,
          state: 1,
          country: 1,
          website: 1,
          social_links: 1,
          cumulative_rating: 1,
          total_number_of_ratings: 1,
          total_products: 1,
          total_items_sold: 1,
          success_rate: 1,
          successful_deliveries: 1,
          followers_count: 1,
          is_featured: 1,
          year_founded: 1,
          accepts_external_fabric: 1,
          createdAt: 1,
          // Exclude: created_by, NIN, BVN, bvn, nin, revenue, orders,
          // earnings, payout data, team_members, order_settings, etc.
        },
      },
    ]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Business not found');
    }

    return result[0];
  }

  async findBusinessById(businessId: string) {
    const result = await this.businessModel.aggregate([
      { $match: { _id: new Types.ObjectId(businessId) } },

      {
        $lookup: {
          from: 'users',
          let: { vendorId: '$created_by.id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$vendorId'] } } },
            { $project: { _id: 1, full_name: 1, email: 1 } }, // only name and email
          ],
          as: 'vendor',
        },
      },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },

      // 2️⃣ All products for this business
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'business',
          as: 'products',
        },
      },

      // 3️⃣ Orders that contain this business AND are completed
      {
        $lookup: {
          from: 'orders',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                status: 'completed',
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: '$items',
                          as: 'it',
                          cond: { $eq: ['$$it.business', '$$businessId'] },
                        },
                      },
                    },
                    0,
                  ],
                },
              },
            },
          ],
          as: 'orders',
        },
      },

      // 4️⃣ Calculated fields
      {
        $addFields: {
          total_products: { $size: '$products' },
          total_orders: { $size: '$orders' },
          total_revenue: { $sum: '$orders.total' },
        },
      },

      // 5️⃣ Remove raw arrays
      {
        $project: {
          products: 0,
          orders: 0,
        },
      },
    ]);

    if (!result || result.length === 0) {
      throw new NotFoundException('Business not found');
    }

    return result[0]; // single business
  }

  async updateBusinessAddress(
    business: Business,
    dto: CreateBusinessAddressDto,
  ) {
    // Vendor warehouse addresses must be in Nigeria (Shipbubble coverage)
    const country = (dto.country || '').trim().toLowerCase();
    if (country && country !== 'nigeria' && country !== 'ng') {
      throw new BadRequestException(
        'Vendor warehouse addresses are currently limited to Nigeria. Please provide a Nigerian address.',
      );
    }

    try {
      const validateAddress = await this.logisticService.validateAddress({
        ...dto,
        name: business.business_name,
        phone: business.business_phone_number as string,
        email: business.business_email,
      });
      return this.businessModel.findByIdAndUpdate(
        business.id,
        {
          ...dto,
          business_address: validateAddress.formatted_address,
          address_code: validateAddress.address_code,
          validated_address: validateAddress.formatted_address,
          address_completed: true,
        },
        { new: true },
      );
    } catch (err) {
      throw new HttpException(
        err.message || err?.response?.data || 'Unable to update address',
        err?.response?.status || 500,
      );
    }
  }

  async updateBusinessProfile(businessId: string, dto: any) {
    const business = await this.businessModel.findByIdAndUpdate(
      businessId,
      { $set: dto },
      { new: true },
    );
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  async updateBusinessStatus(
    businessId: string,
    status: 'in-review' | 'approved' | 'verified' | 'rejected' | 'unverified',
  ) {
    const business = await this.businessModel.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    business.status = status;
    await business.save();

    return {
      message: `Business ${status} successfully`,
      data: business,
    };
  }
  async approveBusiness(businessId: string) {
    return this.updateBusinessStatus(businessId, 'approved');
  }
  async verifyBusiness(businessId: string) {
    return this.updateBusinessStatus(businessId, 'verified');
  }
  async rejectBusiness(businessId: string) {
    return this.updateBusinessStatus(businessId, 'rejected');
  }
  async setInReview(businessId: string) {
    return this.updateBusinessStatus(businessId, 'in-review');
  }
  async followBusiness(userId: string, businessId: string) {
    const session = await this.businessModel.startSession();
    session.startTransaction();

    try {
      const business = await this.businessModel
        .findById(businessId)
        .session(session);
      if (!business) throw new NotFoundException('Business not found');

      const user = await this.userModel.findById(userId).session(session);
      if (!user) throw new NotFoundException('User not found');

      if (business.followers?.includes(new Types.ObjectId(userId))) {
        return { message: 'Followed successfully' };
      }

      await this.businessModel.updateOne(
        { _id: businessId },
        { $addToSet: { followers: userId } },
        { session },
      );

      await this.userModel.updateOne(
        { _id: userId },
        { $addToSet: { following_businesses: businessId } },
        { session },
      );

      await session.commitTransaction();
      session.endSession();

      return { message: 'Followed successfully' };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }

  async unfollowBusiness(userId: string, businessId: string) {
    const session = await this.businessModel.startSession();
    session.startTransaction();

    try {
      const business = await this.businessModel
        .findById(businessId)
        .session(session);
      if (!business) throw new NotFoundException('Business not found');

      await this.businessModel.updateOne(
        { _id: businessId },
        { $pull: { followers: userId } },
        { session },
      );

      await this.userModel.updateOne(
        { _id: userId },
        { $pull: { following_businesses: businessId } },
        { session },
      );

      await session.commitTransaction();
      session.endSession();

      return { message: 'Unfollowed successfully' };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
  async getFollowersCount(businessId: string) {
    const business = await this.businessModel.findById(businessId);

    if (!business) throw new NotFoundException('Business not found');

    return { followers: business.followers?.length };
  }
  async getUserFollowingBusinesses(userId: string, dto: PaginationQueryType) {
    const user = await this.userModel
      .findById(userId)
      .select('following_businesses')
      .lean();

    if (!user) throw new NotFoundException('User not found');

    // Only extract the IDs for the query
    const followingIds = (user.following_businesses || []).map(
      (b: any) => b._id,
    );

    const { take, skip } = await Utils.getPagination(
      Number(dto?.page),
      Number(dto?.size),
    );

    const [businesses, count] = await Promise.all([
      this.businessModel
        .find({ _id: { $in: followingIds } })
        .skip(skip)
        .limit(take)
        .lean(),
      this.businessModel.countDocuments({
        _id: { $in: followingIds },
      }),
    ]);

    // Sanitize after fetching from DB
    const sanitizedBusinesses = businesses.map((business) => ({
      ...sanitizeBusiness(business),
      following: true,
    }));

    return Utils.getPagingData(
      {
        count,
        rows: sanitizedBusinesses,
      },
      Number(dto?.page),
      Number(dto?.size),
    );
  }

  /**
   * Get a paginated, sorted list of all approved/verified vendors.
   * Called when page/limit query params are provided.
   */
  async getVendorsPaginated(user: string, page = 1, limit = 20) {
    const userObjectId = new Types.ObjectId(user);
    const skip = (page - 1) * limit;

    const matchStage = {
      $match: {
        status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] },
      },
    };

    // Get total count for pagination metadata
    const [countResult] = await this.businessModel.aggregate([
      matchStage,
      { $count: 'total' },
    ]);
    const total = countResult?.total || 0;

    const vendors = await this.businessModel.aggregate([
      matchStage,
      { $sort: { total_items_sold: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },

      /**
       * 🔹 LOOKUP: 3 sample products per vendor
       */
      {
        $lookup: {
          from: 'products',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$$businessId'] },
              },
            },
            { $sample: { size: 3 } },
            {
              $addFields: {
                images: {
                  $cond: [
                    { $eq: ['$kind', 'accessory'] },
                    { $ifNull: ['$accessory.images', []] },
                    {
                      $cond: [
                        { $eq: ['$kind', 'clothing'] },
                        { $ifNull: ['$clothing.images', []] },
                        {
                          $cond: [
                            { $eq: ['$kind', 'fabric'] },
                            { $ifNull: ['$fabric.images', []] },
                            [],
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                kind: 1,
                base_price: 1,
                images: { $slice: ['$images', 1] },
                ratings: 1,
                average_rating: 1,
              },
            },
          ],
          as: 'products',
        },
      },

      /**
       * 🔹 COMPUTED METRICS
       */
      {
        $addFields: {
          total_products: { $size: '$products' },

          total_number_of_ratings: {
            $sum: {
              $map: {
                input: '$products',
                as: 'p',
                in: { $size: { $ifNull: ['$$p.ratings', []] } },
              },
            },
          },

          cumulative_rating: {
            $cond: [
              { $gt: [{ $size: '$products' }, 0] },
              { $avg: '$products.average_rating' },
              0,
            ],
          },

          following: {
            $in: [userObjectId, { $ifNull: ['$followers', []] }],
          },

          followers_count: {
            $size: { $ifNull: ['$followers', []] },
          },
        },
      },

      /**
       * 🔹 FINAL RESPONSE SHAPE
       */
      {
        $project: {
          _id: 1,
          business_name: 1,
          business_logo_url: 1,
          description: 1,
          city: 1,
          country: 1,

          total_items_sold: 1,
          cumulative_rating: 1,
          total_products: 1,
          total_number_of_ratings: 1,

          following: 1,
          followers_count: 1,
          products: {
            _id: 1,
            kind: 1,
            base_price: 1,
            images: 1,
          },
        },
      },
    ]);

    return {
      data: vendors,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRandomBusinesses(user: string, limit = 5) {
    const userObjectId = new Types.ObjectId(user);

    return this.businessModel.aggregate([
      /**
       * 🔹 MATCH: Only approved/verified businesses
       */
      {
        $match: {
          status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] },
        },
      },

      /**
       * 🔹 RANDOM SAMPLE: Reliable random selection via MongoDB $sample
       * Fetch more than needed because we filter out businesses with no products later
       */
      { $sample: { size: limit * 3 } },

      /**
       * 🔹 RANDOM + MINIMAL PRODUCTS
       */
      {
        $lookup: {
          from: 'products',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$$businessId'] },
              },
            },

            { $sample: { size: 3 } },

            {
              $addFields: {
                images: {
                  $cond: [
                    { $eq: ['$kind', 'accessory'] },
                    { $ifNull: ['$accessory.images', []] },
                    {
                      $cond: [
                        { $eq: ['$kind', 'clothing'] },
                        { $ifNull: ['$clothing.images', []] },
                        {
                          $cond: [
                            { $eq: ['$kind', 'fabric'] },
                            { $ifNull: ['$fabric.images', []] },
                            [],
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },

            {
              $project: {
                _id: 1,
                kind: 1,
                base_price: 1,
                images: { $slice: ['$images', 1] },

                ratings: 1,
                average_rating: 1,
              },
            },
          ],
          as: 'products',
        },
      },

      /**
       * 🔹 FILTER: ONLY BUSINESSES WITH PRODUCTS
       */
      {
        $match: {
          products: { $ne: [], $exists: true },
        },
      },

      /**
       * 🔹 TRIM TO REQUESTED LIMIT (after filtering)
       */
      { $limit: limit },

      /**
       * 🔹 COMPUTED METRICS
       */
      {
        $addFields: {
          total_products: { $size: '$products' },

          total_number_of_ratings: {
            $sum: {
              $map: {
                input: '$products',
                as: 'p',
                in: { $size: { $ifNull: ['$$p.ratings', []] } },
              },
            },
          },

          cumulative_rating: {
            $cond: [
              { $gt: [{ $size: '$products' }, 0] },
              { $avg: '$products.average_rating' },
              0,
            ],
          },

          following: {
            $in: [userObjectId, { $ifNull: ['$followers', []] }],
          },

          followers_count: {
            $size: { $ifNull: ['$followers', []] },
          },
        },
      },

      /**
       * 🔹 FINAL RESPONSE SHAPE
       */
      {
        $project: {
          _id: 1,
          business_name: 1,
          business_logo_url: 1,
          description: 1,
          city: 1,
          country: 1,

          total_items_sold: 1,
          cumulative_rating: 1,
          total_products: 1,
          total_number_of_ratings: 1,

          following: 1,
          followers_count: 1,
          products: {
            _id: 1,
            kind: 1,
            base_price: 1,
            images: 1,
          },
        },
      },
    ]);
  }
  async getSingleBusiness(userId: string, businessId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const businessObjectId = new Types.ObjectId(businessId);
    const result = await this.businessModel.aggregate([
      /**
       * 1️⃣ Match business
       */
      {
        $match: {
          _id: businessObjectId,
          status: { $in: [BusinessStatus.APPROVED, BusinessStatus.VERIFIED] },
        },
      },

      /**
       * 2️⃣ Lookup products (for computation only)
       */
      {
        $lookup: {
          from: 'products',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$$businessId'] },
              },
            },
            {
              $project: {
                average_rating: 1,
                ratings: 1,
                total_items_sold: 1,
              },
            },
          ],
          as: 'products',
        },
      },

      /**
       * 3️⃣ Ensure vendor has products
       */
      {
        $match: {
          'products.0': { $exists: true },
        },
      },

      /**
       * 4️⃣ Computed fields
       */
      {
        $addFields: {
          total_products: { $size: '$products' },

          total_items_sold: {
            $sum: {
              $map: {
                input: '$products',
                as: 'p',
                in: { $ifNull: ['$$p.total_items_sold', 0] },
              },
            },
          },

          total_number_of_ratings: {
            $sum: {
              $map: {
                input: '$products',
                as: 'p',
                in: { $size: { $ifNull: ['$$p.ratings', []] } },
              },
            },
          },

          cumulative_rating: {
            $cond: [
              { $gt: [{ $size: '$products' }, 0] },
              { $avg: '$products.average_rating' },
              0,
            ],
          },

          following: {
            $in: [userObjectId, { $ifNull: ['$followers', []] }],
          },

          followers_count: {
            $size: { $ifNull: ['$followers', []] },
          },
        },
      },
      {
        $project: {
          _id: 1,
          business_name: 1,
          business_logo_url: 1,
          description: 1,
          city: 1,
          country: 1,
          total_items_sold: 1,
          cumulative_rating: 1,
          total_products: 1,
          total_number_of_ratings: 1,

          following: 1,
          followers_count: 1,
        },
      },
    ]);

    return result[0] || null;
  }

  // in product.service.ts or a dedicated service like business-earnings.service.ts
  async recordBusinessEarnings(orderId: Types.ObjectId) {
    this.logger.log(`Recording business earnings for order: ${orderId}`);

    const order = await this.orderModel.findById(orderId);
    if (!order?.items || order.items.length === 0) {
      this.logger.warn(`Order ${orderId} has no items. Skipping earnings.`);
      return;
    }

    const platformSettings = await this.platformSettingsModel.findOne().lean();
    const commissionPercent =
      platformSettings?.platform_commission_percent ?? 10;
    this.logger.log(`Using platform commission: ${commissionPercent}%`);

    let totalOrderNet = 0;
    let totalOrderCommission = 0;

    for (const item of order.items) {
      const businessId = item.business;
      this.logger.log(`Processing item for business: ${businessId}`);

      // item.total_price is pre-computed by calculateItemTotal() during checkout
      // and already includes: base_price + color variants + styles + fabrics
      //                      + accessories + addons (the full item cost).
      const gross = item.total_price || 0;
      const commission = gross * (commissionPercent / 100);
      const net = gross - commission;

      this.logger.log(
        `Item totals for business ${businessId}: gross=${gross}, commission=${commission}, net=${net}`,
      );

      // Check if this is a custom clothing item that qualifies for milestone split
      const isCustom = (item as any).clothing_type === 'customize';
      const upfrontPercent = (platformSettings as any)?.tailored_order_upfront_percent ?? 0;

      if (isCustom && upfrontPercent > 0) {
        // Split earnings: upfront (released on vendor confirm) + completion (released after delivery)
        const upfrontNet = net * (upfrontPercent / 100);
        const completionNet = net - upfrontNet;

        await this.businessEarningsModel.create({
          business: businessId,
          order: order._id,
          amount: gross * (upfrontPercent / 100),
          commission: commission * (upfrontPercent / 100),
          net_amount: upfrontNet,
          released: false,
          release_date: null,
          milestone: 'upfront',
        });

        await this.businessEarningsModel.create({
          business: businessId,
          order: order._id,
          amount: gross * ((100 - upfrontPercent) / 100),
          commission: commission * ((100 - upfrontPercent) / 100),
          net_amount: completionNet,
          released: false,
          release_date: null,
          milestone: 'completion',
        });

        this.logger.log(
          `Milestone split for custom order: upfront=₦${upfrontNet}, completion=₦${completionNet}`,
        );
      } else {
        // Standard single earning (ready-to-wear, fabric, accessory, or 0% upfront)
        await this.businessEarningsModel.create({
          business: businessId,
          order: order._id,
          amount: gross,
          commission,
          net_amount: net,
          released: false,
          release_date: null,
          milestone: 'completion',
        });
      }

      // Increment pending_balance on the vendor's wallet
      await this.walletModel.findOneAndUpdate(
        { business: businessId },
        { $inc: { pending_balance: net } },
        { upsert: true },
      );

      this.logger.log(`Business earnings recorded for business ${businessId} (pending_balance +₦${net})`);

      totalOrderNet += net;
      totalOrderCommission += commission;
    }

    // Write the totals back to the order so the vendor can see per-order earnings
    await this.orderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          vendor_earnings: totalOrderNet,
          platform_commission: totalOrderCommission,
        },
      },
    );

    this.logger.log(`Finished recording earnings for order: ${orderId}`);
  }

  async getFeed(
    user: string,
    page: number = 1,
    size: number = 10,
    business_limit: number = 5,
  ) {
    const [businesses, products] = await Promise.all([
      this.getRandomBusinesses(user, business_limit),
      this.productService.getLatestProducts(page, size),
    ]);

    return {
      businesses,
      latest_products: products,
    };
  }

  async getTopVendorsOfWeek(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    const vendors = await this.businessModel
      .find(
        {
          createdAt: { $lte: new Date() },
          is_active: true,
          status: { $in: ['approved', 'verified'] },
        },
        {
          business_name: 1,
          business_logo_url: 1,
          total_items_sold: 1,
          earnings: 1,
          success_rate: 1,
          createdAt: 1,
          followers: 1, // 👈 needed
        },
      )
      .sort({ total_items_sold: -1 })
      .limit(10)
      .lean()
      .exec();

    return vendors.map((v) => ({
      id: v._id,
      business_name: v.business_name,
      business_logo_url: v.business_logo_url,
      total_items_sold: v.total_items_sold,
      earnings: v.earnings,
      success_rate: v.success_rate,
      createdAt: v.createdAt,

      // ✅ FOLLOWING FLAG
      following: (v.followers || []).some(
        (f) => f.toString() === userObjectId.toString(),
      ),

      // optional but useful
      followers_count: v.followers?.length || 0,
    }));
  }

  async getNewVendorsOfWeek(userId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const userObjectId = new Types.ObjectId(userId);

    const vendors = await this.businessModel
      .find(
        {
          createdAt: { $gte: sevenDaysAgo },
          is_active: true,
          status: { $in: ['approved', 'verified'] },
        },
        {
          business_name: 1,
          business_logo_url: 1,
          total_items_sold: 1,
          earnings: 1,
          success_rate: 1,
          createdAt: 1,
          followers: 1, // 👈 needed
        },
      )
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return vendors.map((v) => ({
      id: v._id,
      business_name: v.business_name,
      business_logo_url: v.business_logo_url,
      total_items_sold: v.total_items_sold,
      earnings: v.earnings,
      success_rate: v.success_rate,
      createdAt: v.createdAt,

      // ✅ FOLLOWING FLAG
      following: (v.followers || []).some(
        (f) => f.toString() === userObjectId.toString(),
      ),

      followers_count: v.followers?.length || 0,
    }));
  }

  async cancelPendingEarnings(orderId: Types.ObjectId) {
    await this.businessEarningsModel.updateMany(
      { order: orderId, released: false },
      { released: true, net_amount: 0, released_at: new Date() },
    );
  }
  async getUpcomingEarnings(
    businessId: string,
    query?: { page?: number; size?: number },
  ) {
    const { page = 1, size = 10 } = query || {};
    const { take, skip } = await Utils.getPagination(page, size);

    const filter = {
      business: new Types.ObjectId(businessId),
      released: false,
    };

    const [earnings, totalCount] = await Promise.all([
      this.businessEarningsModel
        .find(filter)
        .select('net_amount release_date order')
        .skip(skip)
        .limit(take)
        .lean()
        .exec(),
      this.businessEarningsModel.countDocuments(filter),
    ]);

    // Expose frontend-friendly aliases (amount/date/label) alongside the raw
    // fields so the vendor app can render upcoming earnings without a mapping.
    const rows = earnings.map((e) => ({
      ...e,
      amount: e.net_amount,
      date: e.release_date,
      label: e.release_date
        ? new Date(e.release_date).toISOString().slice(0, 10)
        : null,
    }));

    return Utils.getPagingData({ count: totalCount, rows }, page, size);
  }
  async getEarningsChart(businessId: string): Promise<any> {
    const data = await this.businessEarningsModel.aggregate([
      {
        $match: {
          business: new Types.ObjectId(businessId),
          // Show all earnings (released + pending) so the chart isn't empty
          // during the 7-day release window.
        },
      },
      {
        $project: {
          dayOfWeek: { $dayOfWeek: '$createdAt' }, // 1=Sun, 2=Mon, ... 7=Sat
          net_amount: 1,
        },
      },
      {
        $group: {
          _id: '$dayOfWeek',
          totalEarnings: { $sum: '$net_amount' },
        },
      },
    ]);
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const earningsByDay = dayLabels.map((label, index) => {
      const record = data.find((d) => d._id === index + 1);
      return { label, value: record ? record.totalEarnings : 0 };
    });

    return {
      data: {
        chartType: 'bar',
        title: 'Earnings',
        series: [
          {
            key: 'earnings',
            name: 'Earnings',
            color: '#c4b5a0',
            data: earningsByDay,
          },
        ],
      },
    };
  }

  async getVendorCustomers(
    businessId: string,
    page: number = 1,
    limit: number = 20,
    ordersLimit: number = 5,
  ) {
    const skip = (page - 1) * limit;
    const businessObjectId = new Types.ObjectId(businessId);

    const pipeline: any[] = [
      // 1. Match orders that contain items from this vendor
      {
        $match: {
          'items.business': businessObjectId,
        },
      },
      // 2. Sort by newest orders first so the pushed array is ordered
      {
        $sort: { createdAt: -1 },
      },
      // 3. Group by customer to get their orders and count
      {
        $group: {
          _id: '$customer',
          total_orders: { $sum: 1 },
          orders: {
            $push: {
              _id: '$_id',
              reference: '$reference',
              total: '$total',
              status: '$status',
              createdAt: '$createdAt',
            },
          },
        },
      },
      // 4. Lookup the customer details from users collection
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'customer_info',
        },
      },
      {
        $unwind: '$customer_info',
      },
      // 5. Project the needed fields
      {
        $project: {
          _id: 1,
          username: '$customer_info.username',
          full_name: '$customer_info.full_name',
          email: '$customer_info.email',
          phone_number: '$customer_info.phone_number',
          profile_picture: '$customer_info.profile_picture',
          status: '$customer_info.status',
          total_orders: 1,
          // Limit the orders array to ordersLimit
          orders: { $slice: ['$orders', ordersLimit] },
          // Get the default active measurement (first one that is active, or just the first)
          default_measurement: {
            $let: {
              vars: {
                activeMeasurements: {
                  $filter: {
                    input: { $ifNull: ['$customer_info.measurementSets', []] },
                    as: 'm',
                    cond: { $eq: ['$$m.active', true] },
                  },
                },
              },
              in: {
                $cond: {
                  if: { $gt: [{ $size: '$$activeMeasurements' }, 0] },
                  then: { $arrayElemAt: ['$$activeMeasurements', 0] },
                  else: null,
                },
              },
            },
          },
        },
      },
      // 6. Sort by total orders (or can sort by newest first depending on preference, here total_orders)
      {
        $sort: { total_orders: -1 as const },
      },
      // 7. Facet for pagination
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ];

    const result = await this.orderModel.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const data = result[0]?.data || [];

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getVendorCustomerWishlist(businessId: string, customerId: string) {
    const customer = await this.userModel.findById(customerId).select('wishlist').populate({
      path: 'wishlist',
      match: { business: new Types.ObjectId(businessId) }
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    // Filter out nulls (products that didn't match the business filter)
    return (customer.wishlist || []).filter(item => item !== null);
  }

  /**
   * Get customer demographics for a vendor:
   * - Top customer locations (from shipping addresses)
   * - Gender / wears_preference distribution
   * - Total unique customers
   */
  async getCustomerDemographics(businessId: string) {
    const businessObjectId = new Types.ObjectId(businessId);

    // 1. Get unique customer IDs who have ordered from this vendor
    const customerAgg = await this.orderModel.aggregate([
      { $match: { 'items.business': businessObjectId } },
      { $group: { _id: '$customer' } },
    ]);

    const customerIds = customerAgg.map((c) => c._id);
    const totalCustomers = customerIds.length;

    if (totalCustomers === 0) {
      return {
        totalCustomers: 0,
        topLocations: [],
        genderDistribution: [],
        wearsDistribution: [],
        ageGenderDistribution: [],
      };
    }

    // 2. Lookup customer details for gender/wears/dob
    const users = await this.userModel
      .find({ _id: { $in: customerIds } })
      .select('gender wears_preference dob')
      .lean();

    // Gender distribution
    const genderMap: Record<string, number> = {};
    for (const user of users) {
      const gender = (user as any).gender || 'unspecified';
      genderMap[gender] = (genderMap[gender] || 0) + 1;
    }
    const genderDistribution = Object.entries(genderMap).map(([label, value]) => ({
      label,
      value,
    }));

    // Wears preference distribution
    const wearsMap: Record<string, number> = {};
    for (const user of users) {
      const pref = (user as any).wears_preference || 'unspecified';
      wearsMap[pref] = (wearsMap[pref] || 0) + 1;
    }
    const wearsDistribution = Object.entries(wearsMap).map(([label, value]) => ({
      label,
      value,
    }));

    // 3. Top locations from shipping addresses on orders
    const locationAgg = await this.orderModel.aggregate([
      { $match: { 'items.business': businessObjectId } },
      {
        $project: {
          state: '$address.state',
          city: '$address.city',
          customer: 1,
        },
      },
      // Group by customer to avoid counting repeat orders
      {
        $group: {
          _id: '$customer',
          state: { $first: '$state' },
          city: { $first: '$city' },
        },
      },
      // Now group by state to count unique customers per location
      {
        $group: {
          _id: { $ifNull: ['$state', 'Unknown'] },
          customerCount: { $sum: 1 },
        },
      },
      { $sort: { customerCount: -1 } },
      { $limit: 10 },
    ]);

    const topLocations = locationAgg.map((loc) => ({
      location: loc._id,
      customerCount: loc.customerCount,
      percentage: Math.round((loc.customerCount / totalCustomers) * 100),
    }));

    // 4. Age × Gender distribution (for the demographics bar chart)
    const AGE_BUCKETS = [
      { label: '0 - 5', min: 0, max: 5 },
      { label: '6 - 12', min: 6, max: 12 },
      { label: '13 - 18', min: 13, max: 18 },
      { label: '19 - 23', min: 19, max: 23 },
      { label: '24 - 28', min: 24, max: 28 },
      { label: '29 - 33', min: 29, max: 33 },
      { label: '34 - 39', min: 34, max: 39 },
      { label: '40 - 45', min: 40, max: 45 },
      { label: '46 - 50', min: 46, max: 50 },
      { label: '51 - 55', min: 51, max: 55 },
      { label: '56 - 60', min: 56, max: 60 },
      { label: '60 - 70+', min: 61, max: 200 },
    ];

    const ageGenderDistribution = AGE_BUCKETS.map((bucket) => ({
      age: bucket.label,
      male: 0,
      female: 0,
    }));

    const now = new Date();
    for (const user of users) {
      const dob = (user as any).dob;
      if (!dob) continue;
      const birthDate = new Date(dob);
      const age = Math.floor((now.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      const gender = ((user as any).gender || '').toLowerCase();

      const bucketIdx = AGE_BUCKETS.findIndex((b) => age >= b.min && age <= b.max);
      if (bucketIdx === -1) continue;

      if (gender === 'male') {
        ageGenderDistribution[bucketIdx].male++;
      } else if (gender === 'female') {
        ageGenderDistribution[bucketIdx].female++;
      }
    }

    return {
      totalCustomers,
      topLocations,
      genderDistribution,
      wearsDistribution,
      ageGenderDistribution,
    };
  }
}
