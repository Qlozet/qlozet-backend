import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';

@Injectable()
export class BusinessService {
  constructor(
    @InjectModel(Warehouse.name)
    private warehouseModel: Model<WarehouseDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(dto: CreateWarehouseDto, business: string): Promise<Warehouse> {
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

  async findAll(): Promise<Warehouse[]> {
    return this.warehouseModel.find().populate('business', 'name email').exec();
  }

  async findOne(id: string): Promise<Warehouse> {
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

  async update(id: string, dto: CreateWarehouseDto): Promise<Warehouse> {
    const warehouse = await this.warehouseModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }

    return warehouse;
  }

  async delete(id: string): Promise<{ message: string }> {
    const result = await this.warehouseModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Warehouse with ID ${id} not found`);
    }
    return { message: 'Warehouse deleted successfully' };
  }
}
