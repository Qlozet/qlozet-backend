import {
  BadRequestException,
  HttpException,
  Injectable,
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
import { Product, ProductDocument } from '../products/schemas';
import { ProductService } from '../products/products.service';

@Injectable()
export class BusinessService {
  constructor(
    @InjectModel(Business.name)
    private businessModel: Model<BusinessDocument>,
    @InjectModel(Warehouse.name)
    private warehouseModel: Model<WarehouseDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly logisticService: LogisticsService,
    private readonly productService: ProductService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
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

  async findAllWarehouse(): Promise<Warehouse[]> {
    return this.warehouseModel.find().populate('business', 'name email').exec();
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
      .select('following_businesses');

    if (!user) throw new NotFoundException('User not found');

    const followingIds = user.following_businesses || [];
    const { take, skip } = await Utils.getPagination(
      Number(dto?.page),
      Number(dto.size),
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

    return Utils.getPagingData(
      {
        count,
        rows: businesses,
      },
      Number(dto?.page),
      Number(dto.size),
    );
  }
  async getRandomBusinesses(limit = 5) {
    const businesses = await this.businessModel.aggregate([
      { $match: { is_active: true } }, // TODO FETCH BY status: 'approved'
      { $sample: { size: Number(limit) } },
      {
        $lookup: {
          from: 'products', // MongoDB collection name
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

    return businesses;
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

    return await this.businessModel
      .find({
        createdAt: { $lte: new Date() }, // all vendors
        is_active: true,
        status: { $in: ['approved', 'verified'] }, // only active vendors
      })
      .sort({ total_items_sold: -1 }) // or earnings / success_rate
      .limit(10)
      .exec();
  }
  async getNewVendorsOfWeek() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return await this.businessModel
      .find({
        createdAt: { $gte: sevenDaysAgo },
        is_active: true,
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
