import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Utils } from 'src/common/utils/pagination';
import {
  VendorNote,
  VendorNoteDocument,
  VendorNoteKind,
} from './schemas/vendor-note.schema';
import { Business, BusinessDocument } from './schemas/business.schema';
import { CreateVendorNoteDto } from './dto/vendor-note.dto';

/**
 * Internal admin notes and flags on a vendor.
 *
 * `Business.is_flagged` is kept in step with the notes here. It is a
 * denormalisation, and a deliberate one: the vendors LIST needs to mark flagged
 * rows, and joining notes per row — or running a distinct query over the whole
 * notes collection on every page — to answer a boolean would be far more
 * expensive than maintaining it on the two writes that can change it.
 */
@Injectable()
export class VendorNotesService {
  constructor(
    @InjectModel(VendorNote.name)
    private readonly noteModel: Model<VendorNoteDocument>,
    @InjectModel(Business.name)
    private readonly businessModel: Model<BusinessDocument>,
  ) {}

  private toObjectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label} id`);
    }
    return new Types.ObjectId(id);
  }

  /**
   * A vendor's notes, newest first.
   *
   * Vendor-level only: a note pinned to one product belongs on that product's
   * page, and mixing them here would bury the vendor's own record under
   * catalogue chatter. `listForProduct` reads the other half.
   */
  async list(businessId: string, page = 1, size = 20) {
    const business = this.toObjectId(businessId, 'business');
    return this.listBy({ business, product: null }, page, size);
  }

  /** One product's notes and flags, newest first. */
  async listForProduct(productId: string, page = 1, size = 20) {
    const product = this.toObjectId(productId, 'product');
    return this.listBy({ product }, page, size);
  }

  private async listBy(filter: Record<string, unknown>, page = 1, size = 20) {
    const { take, skip } = await Utils.getPagination(page, size);

    const [rows, count] = await Promise.all([
      this.noteModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .populate('author', 'full_name email')
        .populate('resolved_by', 'full_name email')
        .lean(),
      this.noteModel.countDocuments(filter),
    ]);

    return Utils.getPagingData({ count, rows }, page, size);
  }

  async create(businessId: string, authorId: string, dto: CreateVendorNoteDto) {
    const business = this.toObjectId(businessId, 'business');
    const author = this.toObjectId(authorId, 'author');

    const exists = await this.businessModel.exists({ _id: business });
    if (!exists) throw new NotFoundException('Business not found');

    return this.write(business, author, dto, null);
  }

  /**
   * A note or flag about one product. The vendor is taken from the product
   * rather than the caller, so the note is still reachable from the vendor's
   * own record.
   */
  async createForProduct(
    productId: string,
    businessId: string,
    authorId: string,
    dto: CreateVendorNoteDto,
  ) {
    return this.write(
      this.toObjectId(businessId, 'business'),
      this.toObjectId(authorId, 'author'),
      dto,
      this.toObjectId(productId, 'product'),
    );
  }

  private async write(
    business: Types.ObjectId,
    author: Types.ObjectId,
    dto: CreateVendorNoteDto,
    product: Types.ObjectId | null,
  ) {
    const note = await this.noteModel.create({
      business,
      product,
      author,
      body: dto.body.trim(),
      kind: dto.kind ?? VendorNoteKind.NOTE,
    });

    if (note.kind === VendorNoteKind.FLAG) {
      await this.syncFlag(business);
    }

    return note.toObject();
  }

  /**
   * Clear a flag. Notes are not resolvable — there is nothing to resolve about
   * a remark, and a "resolved" note would just be a hidden one.
   */
  async resolve(noteId: string, adminId: string) {
    const id = this.toObjectId(noteId, 'note');

    const note = await this.noteModel.findById(id);
    if (!note) throw new NotFoundException('Note not found');
    if (note.kind !== VendorNoteKind.FLAG) {
      throw new BadRequestException('Only a flag can be resolved.');
    }

    note.resolved = true;
    note.resolved_by = this.toObjectId(adminId, 'admin');
    note.resolved_at = new Date();
    await note.save();

    await this.syncFlag(note.business);
    return note.toObject();
  }

  async remove(noteId: string) {
    const id = this.toObjectId(noteId, 'note');

    const note = await this.noteModel.findById(id);
    if (!note) throw new NotFoundException('Note not found');

    await this.noteModel.deleteOne({ _id: id });
    // Deleting the last open flag un-flags the vendor.
    if (note.kind === VendorNoteKind.FLAG) {
      await this.syncFlag(note.business);
    }

    return { deleted: true, id: noteId };
  }

  /**
   * Recompute `is_flagged` from the notes rather than toggling it.
   *
   * A vendor can carry several flags at once, so setting false on any resolve
   * would clear the mark while other concerns were still open. Counting is the
   * only way to get this right, and it is one indexed count.
   *
   * Product flags are excluded: a concern about one listing is not a concern
   * about the vendor, and letting it set `is_flagged` would mark the vendor
   * across the whole console for a bad photo on one product.
   */
  private async syncFlag(business: Types.ObjectId) {
    const open = await this.noteModel.countDocuments({
      business,
      product: null,
      kind: VendorNoteKind.FLAG,
      resolved: false,
    });

    await this.businessModel.updateOne(
      { _id: business },
      { $set: { is_flagged: open > 0 } },
    );
  }
}
