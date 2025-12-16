import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { Business, BusinessDocument } from './schemas/business.schema';
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
export class BusinessService {
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
  ) {}

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
    const sanitizedBusinesses = businesses.map(sanitizeBusiness);

    return Utils.getPagingData(
      {
        count,
        rows: sanitizedBusinesses,
      },
      Number(dto?.page),
      Number(dto?.size),
    );
  }

  async getRandomBusinesses(limit = 5) {
    return this.businessModel.aggregate([
      {
        $match: {
          status: { $in: ['approved', 'verified'] },
          is_active: true,
        },
      },
      { $sample: { size: limit } },
      { $limit: limit }, // 👈 force limit
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'business',
          as: 'products',
        },
      },
      {
        $addFields: {
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
          total_products: { $size: '$products' },
        },
      },
      {
        $project: {
          _id: 1,
          business_name: 1,
          business_logo_url: 1,
          description: 1,
          total_items_sold: 1,
          city: 1,
          country: 1,
          cumulative_rating: 1,
          total_products: 1,
          total_number_of_ratings: 1,
        },
      },
    ]);
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

    for (const item of order.items) {
      const businessId = item.business;
      this.logger.log(`Processing item for business: ${businessId}`);

      const colorVariantsTotal = (item.color_variant_selections || []).reduce(
        (sum, cv) => sum + cv.price * cv.quantity,
        0,
      );
      const stylesTotal = (item.style_selections || []).reduce(
        (sum, s) => sum + s.price * s.quantity,
        0,
      );
      const fabricsTotal = (item.fabric_selections || []).reduce(
        (sum, f) => sum + f.price * f.quantity,
        0,
      );
      const accessoriesTotal = (item.accessory_selections || []).reduce(
        (sum, a) => sum + a.price * a.quantity,
        0,
      );

      const gross =
        colorVariantsTotal + stylesTotal + fabricsTotal + accessoriesTotal;
      const commission = gross * (commissionPercent / 100);
      const net = gross - commission;

      this.logger.log(
        `Item totals for business ${businessId}: gross=${gross}, commission=${commission}, net=${net}`,
      );

      await this.businessEarningsModel.create({
        business: businessId,
        order: order._id,
        amount: gross,
        commission,
        net_amount: net,
        released: false,
        release_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      this.logger.log(`Business earnings recorded for business ${businessId}`);
    }

    this.logger.log(`Finished recording earnings for order: ${orderId}`);
  }

  async getFeed(
    page: number = 1,
    size: number = 10,
    business_limit: number = 5,
  ) {
    const [businesses, products] = await Promise.all([
      this.getRandomBusinesses(business_limit),
      this.productService.getLatestProducts(page, size),
    ]);

    return {
      businesses,
      latest_products: products,
    };
  }
  async getTopVendorsOfWeek() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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
    }));
  }

  async getNewVendorsOfWeek() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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

    return Utils.getPagingData(
      { count: totalCount, rows: earnings },
      page,
      size,
    );
  }
}
