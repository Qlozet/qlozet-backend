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
 * A note can also be scoped to one of the vendor's PRODUCTS by setting
 * `product`. Same author, body, kind and resolution semantics — the only
 * difference is what it is about — so the product catalogue's notes live here
 * rather than in a second collection with the same five fields. `business` is
 * always set, product note or not: a product belongs to a vendor, and "every
 * note about this vendor" stays one indexed query.
 *
 * Never shown to the vendor — this is the admin console's own record.
 */
@Schema({ timestamps: true })
export class VendorNote {
  @Prop({ type: Types.ObjectId, ref: 'Business', required: true, index: true })
  business: Types.ObjectId;

  /**
   * Set when the note is about one product rather than the vendor as a whole.
   * Null on vendor-level notes, which is what `Business.is_flagged` counts.
   */
  @Prop({ type: Types.ObjectId, ref: 'Product', default: null, index: true })
  product?: Types.ObjectId | null;

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

// The console lists a subject's notes newest-first; these are the only two
// read shapes — a vendor's notes, and one product's.
VendorNoteSchema.index({ business: 1, createdAt: -1 });
VendorNoteSchema.index({ product: 1, createdAt: -1 });
