import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true })
  business: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  user?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  role: Types.ObjectId;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  full_name: string;

  @Prop()
  phone_number?: string;

  @Prop({ default: false })
  accepted: boolean;

  // Previously written by inviteTeamMember but never declared, so Mongoose
  // silently dropped them. Declared now so is_active (soft-delete) and is_owner
  // actually persist.
  @Prop({ type: Boolean, default: true })
  is_active: boolean;

  @Prop({ type: Boolean, default: false })
  is_owner: boolean;

  @Prop()
  invite_token?: string;

  @Prop()
  invite_expires?: Date;

  @Prop()
  invited_by?: Types.ObjectId;
}

export type TeamMemberDocument = TeamMember & Document;
export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);
