import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SizeGuide, SizeGuideDocument } from './schemas/size-guide.schema';
import { CreateSizeGuideDto } from './dto/create-size-guide.dto';
import { UpdateSizeGuideDto } from './dto/update-size-guide.dto';
import {
  RecommendSizeDto,
  RecommendSizeResponseDto,
  BodyPartBreakdownDto,
  GarmentMeasurementDto,
} from './dto/recommend-size.dto';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { User, UserDocument } from '../ums/schemas/user.schema';
import { listingMeetsCondition } from 'src/common/utils/conditionUtils';
import {
  SUPPORTED_BODY_PARTS,
  cmToInch,
  inchToCm,
} from 'src/common/constants/body-parts.constant';
import { OnEvent } from '@nestjs/event-emitter';
import { customerVisibleModeration } from '../products/customer-visibility';

@Injectable()
export class SizeGuideService {
  private readonly logger = new Logger(SizeGuideService.name);

  constructor(
    @InjectModel(SizeGuide.name)
    private sizeGuideModel: Model<SizeGuideDocument>,
    @InjectModel(Product.name)
    private productModel: Model<ProductDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  /* ═══════════════════════════════════════════════════════
   *  CRUD
   * ═══════════════════════════════════════════════════════ */

  async create(dto: CreateSizeGuideDto, businessId: string) {
    // Validate body parts
    this.validateBodyParts(dto.body_parts);
    this.validateRanges(dto.sizes);

    const guide = await this.sizeGuideModel.create({
      ...dto,
      business: new Types.ObjectId(businessId),
    });

    // Auto-apply to matching products
    await this.syncProductsForGuide(guide);

    return guide;
  }

  async findAll(businessId: string) {
    return this.sizeGuideModel
      .find({ business: new Types.ObjectId(businessId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findById(id: string, businessId: string) {
    const guide = await this.sizeGuideModel
      .findOne({
        _id: new Types.ObjectId(id),
        business: new Types.ObjectId(businessId),
      })
      .lean()
      .exec();

    if (!guide) throw new NotFoundException('Size guide not found');
    return guide;
  }

  async update(id: string, dto: UpdateSizeGuideDto, businessId: string) {
    if (dto.body_parts) this.validateBodyParts(dto.body_parts);
    if (dto.sizes) this.validateRanges(dto.sizes);

    const guide = await this.sizeGuideModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          business: new Types.ObjectId(businessId),
        },
        { $set: dto },
        { new: true },
      )
      .exec();

    if (!guide) throw new NotFoundException('Size guide not found');

    // Re-sync products after update
    await this.syncProductsForGuide(guide);

    return guide;
  }

  async delete(id: string, businessId: string) {
    const guide = await this.sizeGuideModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        business: new Types.ObjectId(businessId),
      })
      .exec();

    if (!guide) throw new NotFoundException('Size guide not found');

    // Clear the size_guide ref from all products that had it
    await this.productModel.updateMany(
      { size_guide: guide._id },
      { $set: { size_guide: null } },
    );

    return { deleted: true, id };
  }

  /* ═══════════════════════════════════════════════════════
   *  MANUAL INCLUDE / EXCLUDE
   * ═══════════════════════════════════════════════════════ */

  async includeProduct(
    guideId: string,
    productId: string,
    businessId: string,
  ) {
    const guideOid = new Types.ObjectId(guideId);
    const productOid = new Types.ObjectId(productId);

    const guide = await this.sizeGuideModel.findOne({
      _id: guideOid,
      business: new Types.ObjectId(businessId),
    });
    if (!guide) throw new NotFoundException('Size guide not found');

    // Remove from manual_excludes if present, add to manual_includes
    await this.sizeGuideModel.updateOne(
      { _id: guideOid },
      {
        $pull: { manual_excludes: productOid },
        $addToSet: { manual_includes: productOid },
      },
    );

    // One guide holds a hand-picked listing at a time.
    await this.sizeGuideModel.updateMany(
      { business: guide.business, _id: { $ne: guideOid } },
      { $pull: { manual_includes: productOid } },
    );

    // Stamp the product
    await this.stampProduct(productOid, guideOid);

    return { message: 'Product included in size guide' };
  }

  async excludeProduct(
    guideId: string,
    productId: string,
    businessId: string,
  ) {
    const guideOid = new Types.ObjectId(guideId);
    const productOid = new Types.ObjectId(productId);

    const guide = await this.sizeGuideModel.findOne({
      _id: guideOid,
      business: new Types.ObjectId(businessId),
    });
    if (!guide) throw new NotFoundException('Size guide not found');

    // Remove from manual_includes if present, add to manual_excludes
    await this.sizeGuideModel.updateOne(
      { _id: guideOid },
      {
        $pull: { manual_includes: productOid },
        $addToSet: { manual_excludes: productOid },
      },
    );

    // Un-stamp the product (only if it's currently using this guide)
    await this.productModel.updateOne(
      { _id: productOid, size_guide: guideOid },
      { $set: { size_guide: null } },
    );

    return { message: 'Product excluded from size guide' };
  }

  /* ═══════════════════════════════════════════════════════
   *  PRODUCT-FACING LOOKUPS
   * ═══════════════════════════════════════════════════════ */

  /** Get the size guide for a specific product (public-facing) */
  async getGuideForProduct(productId: string) {
    const product = await this.productModel
      .findById(productId)
      .select('size_guide')
      .lean();

    if (!product?.size_guide) {
      throw new NotFoundException('No size guide found for this product');
    }

    // A guide the vendor switched off is hidden from shoppers everywhere it
    // is attached, without detaching it.
    const guide = await this.sizeGuideModel
      .findOne({ _id: product.size_guide, is_active: { $ne: false } })
      .select('title description unit body_parts sizes fit_types')
      .lean()
      .exec();
    if (!guide) {
      throw new NotFoundException('No size guide found for this product');
    }
    return guide;
  }

  /** Return the list of supported body parts */
  getBodyParts() {
    return {
      body_parts: SUPPORTED_BODY_PARTS,
    };
  }

  /* ═══════════════════════════════════════════════════════
   *  SIZE RECOMMENDATION
   * ═══════════════════════════════════════════════════════ */

  async recommendSize(
    guideId: string,
    userId: string,
    dto: RecommendSizeDto,
  ): Promise<RecommendSizeResponseDto> {
    // 1. Fetch the guide
    const guide = await this.sizeGuideModel.findById(guideId).lean();
    if (!guide) throw new NotFoundException('Size guide not found');

    // 2. Fetch the customer's active measurement set
    const user = await this.userModel
      .findById(userId)
      .select('measurementSets')
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const activeSet = (user.measurementSets || []).find((s) => s.active);
    if (!activeSet) {
      throw new BadRequestException(
        'No active measurement set found. Please save your measurements first.',
      );
    }

    // 3. Convert customer measurements to the guide's unit if needed
    const customerMeasurements = this.normalizeMeasurements(
      activeSet.measurements as Record<string, number>,
      activeSet.unit,
      guide.unit,
    );

    // 4. Score each size
    const sizeScores = guide.sizes.map((size) => {
      const breakdown: BodyPartBreakdownDto[] = [];
      let matchingParts = 0;
      let totalParts = 0;

      for (const bodyPart of guide.body_parts) {
        const customerValue = customerMeasurements[bodyPart];
        const range = size.measurements.find(
          (m) => m.body_part === bodyPart,
        );

        if (!range || customerValue === undefined) continue;

        totalParts++;
        const fits = customerValue >= range.min && customerValue <= range.max;
        if (fits) matchingParts++;

        // Determine note for near-misses
        let note: string | undefined;
        if (!fits) {
          if (customerValue < range.min) {
            const diff = range.min - customerValue;
            note =
              diff <= 2
                ? `${diff.toFixed(1)}${guide.unit} below range — borderline`
                : `Below this size's range`;
          } else {
            const diff = customerValue - range.max;
            note =
              diff <= 2
                ? `${diff.toFixed(1)}${guide.unit} above range — borderline`
                : `Above this size's range`;
          }
        }

        breakdown.push({
          body_part: bodyPart,
          customer_value: Math.round(customerValue * 10) / 10,
          range: `${range.min} – ${range.max}`,
          fits,
          note,
        });
      }

      const confidence = totalParts > 0 ? matchingParts / totalParts : 0;
      return { size, confidence, breakdown };
    });

    // 5. Pick best size — highest confidence; on tie, prefer larger (higher sort_order)
    sizeScores.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (b.size.sort_order ?? 0) - (a.size.sort_order ?? 0),
    );

    const best = sizeScores[0];
    if (!best) {
      throw new BadRequestException(
        'Cannot recommend a size — no sizes defined in this guide',
      );
    }

    // 6. Build garment measurements if a fit type was requested
    let garmentMeasurements: GarmentMeasurementDto[] | undefined;
    if (dto.fit_type) {
      const fit = guide.fit_types.find(
        (f) => f.name === dto.fit_type,
      );
      if (fit) {
        garmentMeasurements = best.breakdown.map((bp) => {
          const allowance =
            fit.allowances.find((a) => a.body_part === bp.body_part)
              ?.value ?? 0;
          const range = best.size.measurements.find(
            (m) => m.body_part === bp.body_part,
          );

          return {
            body_part: bp.body_part,
            body_range: bp.range,
            garment_range: range
              ? `${range.min + allowance} – ${range.max + allowance}`
              : bp.range,
            ease: allowance,
            fit_label: fit.label,
          };
        });
      }
    }

    return {
      recommended_size: best.size.label,
      confidence: Math.round(best.confidence * 100) / 100,
      breakdown: best.breakdown,
      garment_measurements: garmentMeasurements,
      unit: guide.unit,
    };
  }

  /**
   * Find products that have sizes matching the user's measurements.
   */
  async findProductsThatFit(userId: string, options?: { category?: string; limit?: number }) {
    const user = await this.userModel.findById(userId).select('measurementSets').lean();
    if (!user) return [];

    const activeSet = (user.measurementSets || []).find((s) => s.active);
    if (!activeSet || !activeSet.measurements) return [];

    const userMeasurements = activeSet.measurements instanceof Map
      ? Object.fromEntries(activeSet.measurements)
      : (activeSet.measurements as Record<string, number>);

    // Ensure we have at least some basic measurements before trying to match
    if (Object.keys(userMeasurements).length < 2) return [];

    // Fetch all active size guides
    const guides = await this.sizeGuideModel.find({ is_active: true }).lean().exec();

    const fittingGuides: { guideId: Types.ObjectId; bestSize: string; fitScore: number }[] = [];

    for (const guide of guides) {
      if (!guide.sizes || guide.sizes.length === 0) continue;

      const customerMeasurements = this.normalizeMeasurements(
        userMeasurements,
        activeSet.unit,
        guide.unit,
      );

      let bestScore = 0;
      let bestSizeLabel = '';

      for (const size of guide.sizes) {
        let matchingParts = 0;
        let totalParts = 0;

        for (const bodyPart of guide.body_parts) {
          const customerValue = customerMeasurements[bodyPart];
          const range = size.measurements.find((m) => m.body_part === bodyPart);

          if (!range || customerValue === undefined) continue;

          totalParts++;
          if (customerValue >= range.min && customerValue <= range.max) {
            matchingParts++;
          }
        }

        const confidence = totalParts > 0 ? matchingParts / totalParts : 0;
        if (confidence > bestScore) {
          bestScore = confidence;
          bestSizeLabel = size.label;
        }
      }

      // If confidence > 0.6 (more than 60% of body parts fit a particular size perfectly)
      if (bestScore > 0.6) {
        fittingGuides.push({
          guideId: guide._id as Types.ObjectId,
          bestSize: bestSizeLabel,
          fitScore: bestScore,
        });
      }
    }

    if (fittingGuides.length === 0) return [];

    // Fetch products tied to these guides
    const query: any = {
      status: 'active',
      'moderation.status': customerVisibleModeration(),
      size_guide: { $in: fittingGuides.map((g) => g.guideId) },
    };
    if (options?.category) {
      query.category = options.category; // Assuming you have category linking or taxonomy filtering
    }

    const products = await this.productModel
      .find(query)
      .limit(options?.limit || 50)
      .select('name base_price kind size_guide business')
      .populate('business', 'business_name')
      .lean()
      .exec();

    return products.map((product) => {
      const match = fittingGuides.find((g) => g.guideId.equals(product.size_guide as Types.ObjectId));
      return {
        product,
        bestSize: match?.bestSize || 'Unknown',
        fitScore: match?.fitScore || 0,
      };
    }).sort((a, b) => b.fitScore - a.fitScore);
  }

  /* ═══════════════════════════════════════════════════════
   *  CONDITION-BASED PRODUCT MATCHING (auto-sync)
   * ═══════════════════════════════════════════════════════ */

  /**
   * Re-evaluate which products match a size guide and stamp/un-stamp them.
   */
  async syncProductsForGuide(guide: SizeGuideDocument) {
    if (!guide.is_active) return;

    const businessId = guide.business;
    const guideId = guide._id;

    // Fetch all products for this business
    const products = await this.productModel
      .find({ business: businessId })
      .lean()
      .exec();

    const toStamp: Types.ObjectId[] = [];
    const toUnstamp: Types.ObjectId[] = [];

    // A listing is added by hand to one guide at a time: the guide that
    // claims it last (here, or on the listing) takes it from the others.
    if (guide.manual_includes?.length) {
      await this.sizeGuideModel.updateMany(
        { business: businessId, _id: { $ne: guideId } },
        { $pull: { manual_includes: { $in: guide.manual_includes } } },
      );
    }

    // Listings the vendor pinned to a different guide (chosen on the listing,
    // or added by hand there). Rules here never take them over.
    const others = await this.sizeGuideModel
      .find({ business: businessId, _id: { $ne: guideId } })
      .select('manual_includes')
      .lean();
    const pinnedElsewhere = new Set(
      others.flatMap((g: any) => (g.manual_includes ?? []).map((id: any) => String(id))),
    );

    for (const product of products) {
      const productOid = product._id as Types.ObjectId;
      const productGuide = product.size_guide as Types.ObjectId | null;
      const guideOid = guideId as Types.ObjectId;

      if (pinnedElsewhere.has(String(productOid))) continue;

      // Skip manual excludes
      if (
        guide.manual_excludes?.some((id) => id.equals(productOid))
      ) {
        // Ensure it's un-stamped
        if (productGuide?.equals(guideOid)) {
          toUnstamp.push(productOid);
        }
        continue;
      }

      // Manual includes always match
      if (
        guide.manual_includes?.some((id) => id.equals(productOid))
      ) {
        if (!productGuide?.equals(guideOid)) {
          toStamp.push(productOid);
        }
        continue;
      }

      // Evaluate conditions
      const matches = this.productMatchesConditions(product, guide);

      if (matches && !productGuide?.equals(guideOid)) {
        toStamp.push(productOid);
      } else if (!matches && productGuide?.equals(guideOid)) {
        toUnstamp.push(productOid);
      }
    }

    // Batch update
    if (toStamp.length > 0) {
      await this.productModel.updateMany(
        { _id: { $in: toStamp } },
        { $set: { size_guide: guideId } },
      );
    }
    if (toUnstamp.length > 0) {
      await this.productModel.updateMany(
        { _id: { $in: toUnstamp } },
        { $set: { size_guide: null } },
      );
    }

    this.logger.log(
      `SizeGuide ${guideId}: stamped ${toStamp.length}, un-stamped ${toUnstamp.length} products`,
    );
  }

  /** Manually trigger re-sync for a guide */
  async applyGuide(guideId: string, businessId: string) {
    const guide = await this.sizeGuideModel
      .findOne({
        _id: new Types.ObjectId(guideId),
        business: new Types.ObjectId(businessId),
      })
      .exec();

    if (!guide) throw new NotFoundException('Size guide not found');

    await this.syncProductsForGuide(guide);

    const count = await this.productModel.countDocuments({
      size_guide: guide._id,
    });

    return { message: `Size guide applied to ${count} products` };
  }

  /* ═══════════════════════════════════════════════════════
   *  EVENT LISTENER — auto-sync on product changes
   * ═══════════════════════════════════════════════════════ */

  @OnEvent('product.upserted')
  async handleProductUpserted(
    payload: any,
    meta?: { size_guide_chosen?: boolean },
  ) {
    try {
      // The product itself is the payload; older emitters wrapped it.
      const product = payload?.product ?? payload;
      if (!product?.business || !product?._id) return;

      const businessId =
        typeof product.business === 'string'
          ? product.business
          : String(product.business?._id ?? product.business);
      const businessOid = new Types.ObjectId(businessId);
      const productOid = new Types.ObjectId(String(product._id));

      // The vendor picked a guide on the listing (or "No size guide"): that
      // choice is pinned, so no guide's rules move it later.
      if (meta?.size_guide_chosen) {
        await this.pinChoice(productOid, businessOid, product.size_guide ?? null);
        return;
      }

      const guides = await this.sizeGuideModel
        .find({ business: businessOid, is_active: true })
        .sort({ updatedAt: -1 })
        .exec();

      const has = (ids: Types.ObjectId[] | undefined) =>
        (ids ?? []).some((id) => id.equals(productOid));

      // A guide that names this listing by hand wins over any rule; then the
      // most recently saved guide whose rules it meets.
      const chosen =
        guides.find((g) => has(g.manual_includes)) ??
        guides.find(
          (g) => !has(g.manual_excludes) && this.productMatchesConditions(product, g),
        );

      if (chosen) {
        if (String(product.size_guide ?? '') !== String(chosen._id)) {
          await this.stampProduct(productOid, chosen._id as Types.ObjectId);
        }
        return;
      }

      // Nothing covers it any more: clear a guide of this vendor's, if set.
      if (product.size_guide) {
        const currentGuide = await this.sizeGuideModel
          .findOne({ _id: product.size_guide, business: businessOid })
          .lean();
        if (currentGuide) {
          await this.productModel.updateOne(
            { _id: productOid },
            { $set: { size_guide: null } },
          );
        }
      }
    } catch (err) {
      this.logger.warn('Size guide auto-sync failed for product event', err);
    }
  }

  /**
   * Record the guide a vendor chose on the listing. A guide becomes this
   * listing's manual include (and only that one's); "No size guide" excludes
   * it from every guide so their rules leave it alone.
   */
  private async pinChoice(
    productOid: Types.ObjectId,
    businessOid: Types.ObjectId,
    chosen: any,
  ) {
    await this.sizeGuideModel.updateMany(
      { business: businessOid },
      { $pull: { manual_includes: productOid } },
    );
    if (chosen) {
      const chosenOid = new Types.ObjectId(String(chosen?._id ?? chosen));
      await this.sizeGuideModel.updateOne(
        { _id: chosenOid, business: businessOid },
        {
          $addToSet: { manual_includes: productOid },
          $pull: { manual_excludes: productOid },
        },
      );
      await this.sizeGuideModel.updateMany(
        { business: businessOid, _id: { $ne: chosenOid } },
        { $addToSet: { manual_excludes: productOid } },
      );
    } else {
      await this.sizeGuideModel.updateMany(
        { business: businessOid },
        { $addToSet: { manual_excludes: productOid } },
      );
    }
  }

  /* ═══════════════════════════════════════════════════════
   *  PRIVATE HELPERS
   * ═══════════════════════════════════════════════════════ */

  private productMatchesConditions(
    product: any,
    guide: Pick<SizeGuide, 'conditions' | 'condition_match'>,
  ): boolean {
    // A guide without rules covers only the listings added to it by hand.
    const rules = (guide.conditions ?? []).filter(
      (c) => c?.field && c?.operator && c?.value !== undefined && c?.value !== '',
    );
    if (rules.length === 0) return false;

    const results = rules.map((cond) =>
      listingMeetsCondition(product, cond.field, cond.operator, cond.value),
    );

    return guide.condition_match === 'all'
      ? results.every(Boolean)
      : results.some(Boolean);
  }

  private async stampProduct(
    productId: Types.ObjectId,
    guideId: Types.ObjectId,
  ) {
    await this.productModel.updateOne(
      { _id: productId },
      { $set: { size_guide: guideId } },
    );
  }

  /** Every range must run from small to large: "M chest 101–96" is a typo. */
  private validateRanges(
    sizes: { label?: string; measurements?: { body_part: string; min: number; max: number }[] }[] = [],
  ) {
    const bad: string[] = [];
    for (const size of sizes ?? []) {
      for (const m of size?.measurements ?? []) {
        if (Number(m.min) > Number(m.max)) {
          bad.push(`${size.label ?? 'a size'} ${String(m.body_part).replace(/_/g, ' ')}`);
        }
      }
    }
    if (bad.length) {
      throw new BadRequestException(
        `The smallest measurement is bigger than the largest for: ${bad.join(', ')}. Swap them round.`,
      );
    }
  }

  private validateBodyParts(parts: string[]) {
    const invalid = parts.filter(
      (p) => !(SUPPORTED_BODY_PARTS as readonly string[]).includes(p),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid body parts: ${invalid.join(', ')}. ` +
          `Supported: ${SUPPORTED_BODY_PARTS.join(', ')}`,
      );
    }
  }

  /**
   * Convert a measurement map from one unit to another.
   * If units match, returns as-is.
   */
  private normalizeMeasurements(
    measurements: Record<string, number>,
    fromUnit: 'cm' | 'inch',
    toUnit: 'cm' | 'inch',
  ): Record<string, number> {
    if (fromUnit === toUnit) return { ...measurements };

    const convert = fromUnit === 'cm' ? cmToInch : inchToCm;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(measurements)) {
      result[key] = convert(value);
    }
    return result;
  }
}
