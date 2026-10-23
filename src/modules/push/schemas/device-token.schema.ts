import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Which Qlozet app a phone is running: the shop or the vendor app. */
export enum PushApp {
  SHOP = 'shop',
  VENDOR = 'vendor',
}

export enum PushPlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

/**
 * One phone's push token for one of the apps.
 *
 * A token belongs to a device and an app, not to a person: one login can
 * shop and work on a vendor's team, so the shop app and the vendor app on
 * the same phone hold different tokens, and a push goes only to the app it
 * is for (Notification.audience). The token is unique; registering it again
 * under another login moves it, so the previous person stops getting pushes
 * on that phone.
 */
@Schema({ timestamps: true, collection: 'device_tokens' })
export class DeviceToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ type: String, enum: Object.values(PushApp), required: true })
  app: PushApp;

  @Prop({ type: String, enum: Object.values(PushPlatform), required: true })
  platform: PushPlatform;

  /** Stable id from the app, so a reinstall replaces the old row. */
  @Prop({ type: String, default: null })
  device_id?: string | null;

  @Prop({ type: String, default: null })
  app_version?: string | null;

  /** Every registration refreshes this; tokens unseen for 60 days are pruned. */
  @Prop({ type: Date, default: () => new Date(), index: true })
  last_seen_at: Date;
}

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
DeviceTokenSchema.index({ user: 1, app: 1 });
