import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Warehouse, WarehouseDocument } from './schemas/warehouse.schema';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';

@Injectable()
export class BusinessService {
  constructor(
    @InjectModel(Warehouse.name)
    private warehouseModel: Model<WarehouseDocument>,
  ) {}

  async create(dto: CreateWarehouseDto, vendor: string): Promise<Warehouse> {
    const warehouse = new this.warehouseModel(dto);
    return (await warehouse.save()).toJSON();
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
