import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

// ==================== ENUMS ====================

export enum NotificationCategory {
  ORDER = 'order',
  SHIPPING = 'shipping',
  PAYMENT = 'payment',
  BESPOKE = 'bespoke',
  PRODUCT = 'product',
  TEAM = 'team',
  SYSTEM = 'system',
}

export enum NotificationType {
  // Order
  NEW_ORDER = 'new_order',
  ORDER_CONFIRMED = 'order_confirmed',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_STATUS_CHANGED = 'order_status_changed',

  // Shipping
  ORDER_SHIPPED = 'order_shipped',
  ORDER_DELIVERED = 'order_delivered',

  // Payment
  PAYMENT_CONFIRMED = 'payment_confirmed',
  WALLET_PAYMENT_CONFIRMED = 'wallet_payment_confirmed',
  PAYOUT_RELEASED = 'payout_released',
  WALLET_FUNDED = 'wallet_funded',

  // Bespoke
  BESPOKE_QUOTE_REQUEST = 'bespoke_quote_request',
  BESPOKE_QUOTE_RECEIVED = 'bespoke_quote_received',
  BESPOKE_QUOTE_REVISION = 'bespoke_quote_revision',
  BESPOKE_QUOTE_ACCEPTED = 'bespoke_quote_accepted',

  // Product
  NEW_REVIEW = 'new_review',
  LOW_STOCK = 'low_stock',
  PRODUCT_APPROVED = 'product_approved',

  // Team
  TEAM_MEMBER_JOINED = 'team_member_joined',

  // System
  WELCOME = 'welcome',
  ANNOUNCEMENT = 'announcement',
}

// ==================== SCHEMA ====================

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  recipient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Business', index: true })
  recipient_business?: Types.ObjectId;

  @Prop({ required: true, enum: NotificationCategory })
  category: NotificationCategory;

  @Prop({ required: true, enum: NotificationType })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ default: false })
  is_read: boolean;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop()
  action_url?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound index for efficient queries: user's notifications sorted by newest
NotificationSchema.index({ recipient: 1, createdAt: -1 });

// Index for filtering by category
NotificationSchema.index({ recipient: 1, category: 1, createdAt: -1 });

// TTL index: auto-delete notifications older than 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
