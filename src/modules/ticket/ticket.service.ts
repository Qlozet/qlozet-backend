import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket } from './schema/ticket.schema';
import {
  AssignTicketDto,
  CreateTicketDto,
  TicketFilterDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { Utils } from 'src/common/utils/pagination';
import { TicketReply } from './schema/reply-ticket.schema';
import { CreateTicketReplyDto } from './dto/ticket-reply.dto';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<Ticket>,
    @InjectModel(TicketReply.name) private ticketReplyModel: Model<TicketReply>,
  ) {}

  async create(business: string, dto: CreateTicketDto) {
    return this.ticketModel.create({
      business,
      ...dto,
    });
  }

  async createReply(
    ticket_id: Types.ObjectId,
    sender: Types.ObjectId,
    dto: CreateTicketReplyDto,
  ) {
    const reply = new this.ticketReplyModel({
      ticket_id,
      sender,
      message: dto.message,
      attachments: dto.attachments || [],
    });
    await this.ticketModel.findByIdAndUpdate(ticket_id, {
      $push: { replies: reply._id },
    });

    return reply.save();
  }

  async getTicketReplies(ticket_id: string, page = 1, size = 20) {
    const { skip, take } = await Utils.getPagination(page, size);

    const [count, rows] = await Promise.all([
      this.ticketReplyModel.countDocuments({ ticket_id }),
      this.ticketReplyModel
        .find({ ticket_id })
        .skip(skip)
        .limit(take)
        .sort({ createdAt: 1 }),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  async findAssignedTickets(
    assigned_to: Types.ObjectId,
    query: any,
    page: number = 1,
    size: number = 10,
  ) {
    const { take, skip } = await Utils.getPagination(page, size);

    const filter: any = { assigned_to };

    // Optional filters
    if (query.search) {
      filter.$or = [
        { issue_type: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    if (query.status) filter.status = query.status;
    if (query.business) filter.business = query.business;

    if (query.start_date || query.end_date) {
      filter.createdAt = {};
      if (query.start_date) filter.createdAt.$gte = new Date(query.start_date);
      if (query.end_date) filter.createdAt.$lte = new Date(query.end_date);
    }

    const [count, rows] = await Promise.all([
      this.ticketModel.countDocuments(filter),
      this.ticketModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .sort({ createdAt: -1 })
        .populate({
          path: 'replies',
          model: 'TicketReply',
          options: { sort: { createdAt: 1 } }, // oldest → newest
        }),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  async findAll(
    query: TicketFilterDto,
    page: number,
    size: number,
    business?: Types.ObjectId,
  ) {
    const { take, skip } = await Utils.getPagination(page, size);

    const filter: any = {};

    // Search
    if (query.search) {
      filter.$or = [
        { issue_type: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }

    // Status
    if (query.status) {
      filter.status = query.status;
    }

    // Vendor filtering
    if (business) {
      filter.business = business;
    }

    // Assigned support team
    if (query.assigned_to) {
      filter.assigned_to = query.assigned_to;
    }

    // Date range filtering
    if (query.start_date || query.end_date) {
      filter.createdAt = {};
      if (query.start_date) filter.createdAt.$gte = new Date(query.start_date);
      if (query.end_date) filter.createdAt.$lte = new Date(query.end_date);
    }

    const [count, rows] = await Promise.all([
      this.ticketModel.countDocuments(filter),

      this.ticketModel
        .find(filter)
        .skip(skip)
        .limit(take)
        .sort({ createdAt: -1 })
        .populate({
          path: 'replies',
          model: 'TicketReply',
          options: { sort: { createdAt: 1 } },
        }),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  async findOne(id: string) {
    const ticket = await this.ticketModel.findById(id);
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto) {
    const updated = await this.ticketModel.findByIdAndUpdate(id, dto, {
      new: true,
    });

    if (!updated) throw new NotFoundException('Ticket not found');
    return updated;
  }

  async assign(id: string, dto: AssignTicketDto) {
    const updated = await this.ticketModel.findByIdAndUpdate(
      id,
      { assigned_to: dto.support_team_id, status: 'in_progress' },
      { new: true },
    );

    if (!updated) throw new NotFoundException('Ticket not found');
    return updated;
  }
}
