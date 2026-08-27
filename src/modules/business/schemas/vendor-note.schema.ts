import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VendorNoteDocument = VendorNote & Document;

export enum VendorNoteKind {
  /** An ordinary internal remark. */
  NOTE = 'note',
  /** A concern raised against the vendor. Carries the same body as a note. */
  FLAG = 'flag',
}

/**
 * An admin's internal note about a vendor.
 *
 * Notes and flags share one collection because a flag without a reason is
 * useless and a reason IS a note — splitting them would duplicate the author,
 * body and timestamps, and make "everything said about this vendor" two
 * queries that have to be merged and re-sorted.
 *
 * `resolved` only means something for a flag: notes are a permanent record and
 * are deleted rather than resolved, while a flag is a concern that gets cleared
 * once it has been dealt with.
 *
 * Never shown to the vendor — this is the admin console's own record.
 */
@Schema({ timestamps: true })
export class VendorNote {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  business: Types.ObjectId;

  /** The admin who wrote it. Kept so the trail is attributable. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  body: string;

  @Prop({
    type: String,
    enum: Object.values(VendorNoteKind),
    default: VendorNoteKind.NOTE,
    index: true,
  })
  kind: VendorNoteKind;

  @Prop({ type: Boolean, default: false })
  resolved: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolved_by?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  resolved_at?: Date;
}

export const VendorNoteSchema = SchemaFactory.createForClass(VendorNote);

// The console lists a vendor's notes newest-first; this is the only read shape.
VendorNoteSchema.index({ business: 1, createdAt: -1 });
