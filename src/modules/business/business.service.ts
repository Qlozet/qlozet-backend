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

@Injectable()
export class BusinessService {
  constructor(
    @InjectModel(Business.name)
    private businessModel: Model<BusinessDocument>,
    @InjectModel(Warehouse.name)
    private warehouseModel: Model<WarehouseDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly logisticService: LogisticsService,
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
}
