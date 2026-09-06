import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import {
  TicketActivity,
  TicketActivityType,
} from './schema/ticket-activity.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationCategory,
  NotificationType,
} from '../notifications/schemas/notification.schema';

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<Ticket>,
    @InjectModel(TicketReply.name) private ticketReplyModel: Model<TicketReply>,
    @InjectModel(TicketActivity.name)
    private ticketActivityModel: Model<TicketActivity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Fire-and-forget audit row. A logging failure must never fail the ticket
   * action it describes — log loudly and move on.
   */
  private logActivity(
    ticket: Types.ObjectId | string,
    type: TicketActivityType,
    description: string,
    opts: {
      actor?: Types.ObjectId | string | null;
      actorLabel?: string | null;
      metadata?: Record<string, any>;
    } = {},
  ) {
    this.ticketActivityModel
      .create({
        ticket,
        type,
        description,
        actor: opts.actor ?? null,
        actor_label: opts.actorLabel ?? null,
        metadata: opts.metadata ?? {},
      })
      .catch((e: any) =>
        this.logger.error(
          `Failed to log ticket activity (${type}) for ${ticket}: ${e?.message}`,
        ),
      );
  }

  async create(business: string, dto: CreateTicketDto) {
    // Clients send `images`, the schema stores `attachments` — before this
    // mapping, uploaded ticket images were silently dropped.
    const attachments = dto.attachments ?? dto.images ?? [];
    const ticket = await this.ticketModel.create({
      business,
      ...dto,
      attachments,
    });
    this.logActivity(
      ticket._id as Types.ObjectId,
      TicketActivityType.CREATED,
      `Submitted ticket: "${dto.issue_type}"`,
    );
    if (attachments.length) {
      this.logActivity(
        ticket._id as Types.ObjectId,
        TicketActivityType.ATTACHMENT_ADDED,
        `Uploaded ${attachments.length} attachment${
          attachments.length === 1 ? '' : 's'
        }`,
        { metadata: { attachments } },
      );
    }
    return ticket;
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

    const saved = await reply.save();
    this.logActivity(ticket_id, TicketActivityType.REPLIED, dto.message, {
      actor: sender,
      metadata: dto.attachments?.length
        ? { attachments: dto.attachments }
        : {},
    });
    return saved;
  }

  /**
   * Internal note — visible only in the admin console's activity timeline.
   * Notes ARE activity rows; there is no separate collection.
   */
  async addNote(ticketId: string, actorId: string, body: string) {
    const ticket = await this.ticketModel.findById(ticketId).select('_id');
    if (!ticket) throw new NotFoundException('Ticket not found');

    const note = await this.ticketActivityModel.create({
      ticket: ticket._id,
      type: TicketActivityType.NOTE_ADDED,
      description: body,
      actor: actorId,
    });
    return { message: 'Note added', data: note };
  }

  /**
   * The ticket's activity timeline, oldest first. Tickets that predate the
   * log (no stored 'created' row) get a baseline synthesized from the ticket
   * itself and any replies older than the first stored row — so every ticket
   * shows a coherent history without a migration.
   */
  async getActivities(ticketId: string) {
    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('business', 'business_name');
    if (!ticket) throw new NotFoundException('Ticket not found');

    const stored = await this.ticketActivityModel
      .find({ ticket: ticket._id })
      .sort({ createdAt: 1 })
      .populate('actor', 'full_name email')
      .lean();

    const hasCreated = stored.some((a: any) => a.type === 'created');
    const firstStoredAt = stored.length
      ? new Date((stored[0] as any).createdAt).getTime()
      : Infinity;

    const synthesized: any[] = [];
    if (!hasCreated) {
      const businessName = (ticket.business as any)?.business_name;
      synthesized.push({
        _id: `synthetic-created-${ticket._id}`,
        type: 'created',
        description: `Submitted ticket: "${ticket.issue_type}"`,
        actor: null,
        actor_label: businessName ?? null,
        metadata: {},
        createdAt: (ticket as any).createdAt,
      });
      if (ticket.attachments?.length) {
        synthesized.push({
          _id: `synthetic-attachments-${ticket._id}`,
          type: 'attachment_added',
          description: `Uploaded ${ticket.attachments.length} attachment${
            ticket.attachments.length === 1 ? '' : 's'
          }`,
          actor: null,
          actor_label: businessName ?? null,
          metadata: { attachments: ticket.attachments },
          createdAt: (ticket as any).createdAt,
        });
      }
      // Replies from before the log existed — newer ones have real rows.
      const oldReplies = await this.ticketReplyModel
        .find({ ticket_id: ticket._id })
        .sort({ createdAt: 1 })
        .populate('sender', 'full_name email')
        .lean();
      for (const r of oldReplies as any[]) {
        if (new Date(r.createdAt).getTime() >= firstStoredAt) continue;
        synthesized.push({
          _id: `synthetic-reply-${r._id}`,
          type: 'replied',
          description: r.message,
          actor: r.sender ?? null,
          actor_label: null,
          metadata: r.attachments?.length
            ? { attachments: r.attachments }
            : {},
          createdAt: r.createdAt,
        });
      }
    }

    const merged = [...synthesized, ...stored].sort(
      (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return { message: 'Ticket activities', data: merged };
  }

  async getTicketReplies(ticket_id: string, page = 1, size = 20) {
    const { skip, take } = await Utils.getPagination(page, size);

    const [count, rows] = await Promise.all([
      this.ticketReplyModel.countDocuments({ ticket_id }),
      this.ticketReplyModel
        .find({ ticket_id })
        .skip(skip)
        .limit(take)
        .sort({ createdAt: 1 })
        // The admin thread shows who wrote each reply — ids alone forced the
        // console to label replies generically.
        .populate('sender', 'full_name email'),
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
        })
        // The console's "Assigned To" column had only a bare id to render, so
        // it showed a truncated ObjectId where a person's name belongs.
        .populate('assigned_to', 'full_name email'),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  async findOne(id: string) {
    const ticket = await this.ticketModel
      .findById(id)
      .populate('assigned_to', 'full_name email');
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto, actorId?: string) {
    const prev = await this.ticketModel.findById(id).select('status');
    if (!prev) throw new NotFoundException('Ticket not found');

    const updated = await this.ticketModel.findByIdAndUpdate(id, dto, {
      new: true,
    });
    if (!updated) throw new NotFoundException('Ticket not found');

    if (dto.status && dto.status !== prev.status) {
      const resolved = ['resolved', 'closed'].includes(dto.status);
      this.logActivity(
        updated._id as Types.ObjectId,
        resolved
          ? TicketActivityType.RESOLVED
          : TicketActivityType.STATUS_CHANGED,
        resolved
          ? `Marked ticket as ${dto.status === 'closed' ? 'Closed' : 'Resolved'}`
          : `Changed status from ${prev.status} to ${dto.status}`,
        { actor: actorId ?? null, metadata: { from: prev.status, to: dto.status } },
      );
    }
    return updated;
  }

  async assign(id: string, dto: AssignTicketDto, actorId?: string) {
    const updated = await this.ticketModel
      .findByIdAndUpdate(
        id,
        { assigned_to: dto.support_team_id, status: 'in_progress' },
        { new: true },
      )
      .populate('assigned_to', 'full_name email');

    if (!updated) throw new NotFoundException('Ticket not found');

    const assigneeName =
      (updated.assigned_to as any)?.full_name ?? 'a team member';
    this.logActivity(
      updated._id as Types.ObjectId,
      TicketActivityType.ASSIGNED,
      `Reassigned ticket to: ${assigneeName}`,
      {
        actor: actorId ?? null,
        metadata: { assignee: dto.support_team_id, assignee_name: assigneeName },
      },
    );

    // Tell the assignee — in-app notification + realtime socket push.
    // Fire-and-forget: a notification hiccup must never fail the assignment.
    const idTail = String(updated._id).slice(-8).toUpperCase();
    this.notificationsService
      .create({
        recipient: dto.support_team_id,
        category: NotificationCategory.SYSTEM,
        type: NotificationType.TICKET_ASSIGNED,
        title: 'Ticket assigned to you 🎫',
        body: `You've been assigned ticket #${idTail}: "${updated.issue_type}".`,
        metadata: { ticket_id: String(updated._id) },
      })
      .catch((e: any) =>
        this.logger.error(
          `Failed to notify assignee for ticket ${updated._id}: ${e?.message}`,
        ),
      );
    return updated;
  }
}
