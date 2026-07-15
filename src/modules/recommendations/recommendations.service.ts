import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { RetrievalService } from './retrieval/retrieval.service';
import { FiltersService } from './filters/filters.service';
import { RankersService } from './rankers/rankers.service';
import { ExplanationsService } from './explanations/explanations.service';
import { UserEmbeddingsService } from './user-embeddings/user-embeddings.service';
import { EventsService } from './events/events.service';
import { BusinessService } from '../business/business.service';
import {
  VendorFeedResponseDto,
  VendorFeedItemDto,
} from './dto/vendor-feed-response.dto';
import { FeedItemDto } from './dto/feed-response.dto';
import { v4 as uuid } from 'uuid';
import { CatalogService } from './catalog/catalog.service';
import { Order, OrderDocument } from '../orders/schemas/orders.schema';

import { SizeGuideService } from '../size-guide/size-guide.service';

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private retrievalService: RetrievalService,
    private filtersService: FiltersService,
    private rankersService: RankersService,
    private explanationsService: ExplanationsService,
    private userEmbeddingsService: UserEmbeddingsService,
    private eventsService: EventsService,
    private businessService: BusinessService,
    private catalogService: CatalogService,
    private sizeGuideService: SizeGuideService,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  async getHomeFeed(options: {
    userId: string;
    sessionId?: string;
    limit: number;
    budgetMax?: number;
    deadlineDays?: number;
    category?: string;
    gender?: string;
  }) {
    const startTime = Date.now();
    const { userId, sessionId, limit, budgetMax, deadlineDays } = options;

    // 1. User Context & Embeddings
    const userProfileVector =
      await this.userEmbeddingsService.getOrComputeUserStyleVector(userId);
    let sessionVector: number[] | null = null;
    if (sessionId) {
      sessionVector =
        await this.userEmbeddingsService.computeSessionStyleVector(
          userId,
          sessionId,
        );
    }

    // Check if userProfileVector is just explicit preference or full blend?
    // Assuming computeUserStyleVector now returns blend.
    const blendedVector = this.userEmbeddingsService.blendVectors(
      userProfileVector,
      sessionVector,
    );
    const usedSessionBlend = !!sessionVector;
    const coldStartLevel = !blendedVector
      ? 'cold'
      : !userProfileVector
        ? 'warm_session'
        : 'hot';

    // 2. Retrieval
    const candidates =
      await this.retrievalService.retrieveCandidatesForHomeFeed({
        userStyleVector: blendedVector,
        limit: limit * 2, // Fetch more for filtering
        numCandidates: 1000,
      });

    // 2.5 Fetch Vendor/Business Data
    const vendorIds = [
      ...new Set(candidates.map((c) => c.vendor).filter(Boolean)),
    ];
    const businesses = new Map();
    // Assuming BusinessService has a findMany or similar. If not, parallel findOne.
    // Bulk fetch all businesses in a single query (instead of N individual lookups)
    try {
      const businessDocs = await this.businessService.findBusinessesByIds(vendorIds);
      businessDocs.forEach((b) => {
        if (b) businesses.set(String(b._id), b);
      });
    } catch (e) {
      this.logger.warn('Failed to fetch businesses for gating', e);
    }

    // 3. Filtering
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({
      maxPrice: budgetMax,
      category: options.category,
      gender: options.gender,
    });
    if (deadlineDays) filterSpec.deadlineDays = deadlineDays;

    // Apply hard filters (including vendor trust gating)
    const filterResult = this.filtersService.applyHardFilters(
      candidates,
      filterSpec,
      businesses,
    );
    const filtered = filterResult.items;
    const filterMetrics = filterResult.metrics;

    // 3.5 Fetch Perfect Fit Products to Boost
    let perfectFitProducts = new Set<string>();
    try {
      const fits = await this.sizeGuideService.findProductsThatFit(userId, { limit: 100 });
      fits.forEach((f) => {
        perfectFitProducts.add(String(f.product._id));
      });
    } catch (e) {
      this.logger.warn('Failed to fetch perfect fit products for ranking', e);
    }

    // 4. Ranking
    const rankingContext = {
      budgetMax,
      businesses, // Pass businesses for scoring
      perfectFitProducts,
    };
    const ranked = this.rankersService.rankCandidates(filtered, rankingContext);

    const finalItems = ranked.slice(0, limit);

    // 5. Explanations
    const recentHistory = await this.eventsService.getRecentEvents(userId, 20);

    const results = finalItems.map((item) => {
      const reasons = this.explanationsService.generateExplanations(
        item,
        recentHistory,
      );
      return {
        ...item,
        explanations: reasons,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'Pipeline Stats',
      userId,
      durationMs: duration,
      candidates: candidates.length,
      filtered: filtered.length,
      final: results.length,
      coldStartLevel,
      emptyFeed: results.length === 0,
      filterDropOffRate:
        candidates.length > 0
          ? (candidates.length - filtered.length) / candidates.length
          : 0,
      metrics: filterMetrics, // Added detailed metrics to log
    });

    return {
      items: await this.hydrateWithProductData(results),
      debug: {
        coldStartLevel,
        usedSessionBlend,
        candidateCount: candidates.length,
        filteredCount: filtered.length,
        durationMs: duration,
      },
    };
  }

  async getVendorFeed(options: {
    userId: string;
    limit: number;
    productsPerVendor: number;
  }): Promise<VendorFeedResponseDto> {
    const startTime = Date.now();
    const { userId, limit, productsPerVendor } = options;

    // 1. User Context & Embeddings
    const userProfileVector =
      await this.userEmbeddingsService.getOrComputeUserStyleVector(userId);
    const blendedVector = this.userEmbeddingsService.blendVectors(
      userProfileVector,
      null,
    );

    // 2. Retrieval - fetch more candidates to ensure we have enough vendors
    const candidates =
      await this.retrievalService.retrieveCandidatesForHomeFeed({
        userStyleVector: blendedVector,
        limit: limit * productsPerVendor * 3, // Fetch extra to ensure vendor diversity
        numCandidates: 2000,
      });

    // 3. Fetch Vendor/Business Data
    const vendorIds = [
      ...new Set(candidates.map((c) => c.vendor).filter(Boolean)),
    ];
    const businesses = new Map();
    // Bulk fetch all businesses in a single query
    try {
      const businessDocs = await this.businessService.findBusinessesByIds(vendorIds);
      businessDocs.forEach((b) => {
        if (b) businesses.set(String(b._id), b);
      });
    } catch (e) {
      this.logger.warn('Failed to fetch businesses for vendor feed', e);
    }

    // 4. Apply basic filtering
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
    const filterResult = this.filtersService.applyHardFilters(
      candidates,
      filterSpec,
      businesses,
    );
    const filtered = filterResult.items;

    // 5. Group products by vendor
    const vendorProductsMap = new Map<string, typeof filtered>();
    filtered.forEach((item) => {
      if (item.vendor) {
        if (!vendorProductsMap.has(item.vendor)) {
          vendorProductsMap.set(item.vendor, []);
        }
        vendorProductsMap.get(item.vendor)!.push(item);
      }
    });

    // 6. Rank vendors based on aggregate quality
    const vendorScores = Array.from(vendorProductsMap.entries()).map(
      ([vendorId, products]) => {
        const business = businesses.get(vendorId);
        // Rank products first to get finalScore
        const rankedProducts = this.rankersService.rankCandidates(products, {
          businesses,
        });
        const avgScore =
          rankedProducts.reduce((sum, p) => sum + (p.finalScore || 0), 0) /
          rankedProducts.length;
        const vendorQuality = business?.quality_score || 0.5;

        // Combined score: product relevance + vendor quality
        const combinedScore = avgScore * 0.7 + vendorQuality * 0.3;

        return {
          vendorId,
          products: rankedProducts,
          business,
          score: combinedScore,
        };
      },
    );

    // Sort vendors by score
    vendorScores.sort((a, b) => b.score - a.score);

    // 7. Build vendor feed items
    const recentHistory = await this.eventsService.getRecentEvents(userId, 20);
    const vendorFeedItems: VendorFeedItemDto[] = vendorScores
      .slice(0, limit)
      .map((vendorData, vendorIndex) => {
        // Take top N products for this vendor
        const topProducts = vendorData.products
          .slice(0, productsPerVendor)
          .map((item, productIndex) => {
            const explanation = this.explanationsService.generateExplanations(
              item,
              recentHistory,
            );

            return {
              itemId: item.itemId,
              position: vendorIndex * productsPerVendor + productIndex,
              stream: 'vendor_feed',
              reasonCodes: explanation.codes,
              explanations: explanation.texts,
              name: item.name,
              price: item.price,
              vendor: item.vendor,
            } as FeedItemDto;
          });

        // Generate vendor-level explanations
        const vendorExplanations = [
          `Top-rated vendor with ${vendorData.products.length} matching products`,
        ];
        if (vendorData.business?.quality_score) {
          vendorExplanations.push(
            `Quality score: ${(vendorData.business.quality_score * 100).toFixed(0)}%`,
          );
        }

        return {
          vendorId: vendorData.vendorId,
          vendorName: vendorData.business?.name || 'Unknown Vendor',
          vendorScore: vendorData.score,
          reasonCodes: ['VENDOR_QUALITY', 'PRODUCT_RELEVANCE'],
          explanations: vendorExplanations,
          products: topProducts,
          totalProducts: vendorData.products.length,
        };
      });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'Vendor Feed Stats',
      userId,
      durationMs: duration,
      totalVendors: vendorProductsMap.size,
      returnedVendors: vendorFeedItems.length,
      totalProducts: filtered.length,
    });

    // Hydrate vendor feed products with full product data
    const allVendorProducts = vendorFeedItems.flatMap((v) => v.products);
    const hydratedProducts = await this.hydrateWithProductData(allVendorProducts);

    // Map hydrated products back into their vendor groups
    let productIndex = 0;
    for (const vendorItem of vendorFeedItems) {
      vendorItem.products = hydratedProducts.slice(
        productIndex,
        productIndex + vendorItem.products.length,
      );
      productIndex += vendorItem.products.length;
    }

    return {
      requestId: uuid(),
      vendors: vendorFeedItems,
    };
  }

  async getTrendingFeed(options: { limit: number }) {
    const startTime = Date.now();
    const { limit } = options;

    // Fetch trending items (currently just retrieves items, could be enhanced with click/view metrics)
    const trendingItems =
      await this.retrievalService.retrieveTrendingCandidates(limit * 2);

    // Apply basic filtering
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
    const filterResult = this.filtersService.applyHardFilters(
      trendingItems,
      filterSpec,
      new Map(),
    );
    const filtered = filterResult.items;

    // Rank the trending items
    const ranked = this.rankersService.rankCandidates(filtered, {});
    const finalItems = ranked.slice(0, limit);

    // Add explanations
    const results = finalItems.map((item) => {
      const explanation = this.explanationsService.generateExplanations(
        item,
        [],
      );
      return {
        ...item,
        explanations: explanation.texts,
        reasonCodes: explanation.codes,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'Trending Feed Stats',
      durationMs: duration,
      total: results.length,
    });

    return {
      items: await this.hydrateWithProductData(results),
      debug: {
        candidateCount: trendingItems.length,
        filteredCount: filtered.length,
        durationMs: duration,
      },
    };
  }

  async getNewArrivalsFeed(options: { limit: number; days: number }) {
    const startTime = Date.now();
    const { limit, days } = options;

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Fetch only items created since cutoff (sorted newest-first by DB)
    const newItems = await this.catalogService.findRecent(cutoffDate, limit * 2);

    // Apply filtering
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
    const filterResult = this.filtersService.applyHardFilters(
      newItems,
      filterSpec,
      new Map(),
    );
    const filtered = filterResult.items;

    // Rank the items
    const ranked = this.rankersService.rankCandidates(filtered, {});
    const finalItems = ranked.slice(0, limit);

    // Add explanations
    const results = finalItems.map((item) => {
      const explanation = this.explanationsService.generateExplanations(
        item,
        [],
      );
      return {
        ...item,
        explanations: ['Just added!', ...explanation.texts],
        reasonCodes: ['NEW_ARRIVAL', ...explanation.codes],
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'New Arrivals Feed Stats',
      durationMs: duration,
      days,
      newItemsFound: newItems.length,
      returned: results.length,
    });

    return {
      items: await this.hydrateWithProductData(results),
      debug: {
        totalNewItems: newItems.length,
        cutoffDate: cutoffDate.toISOString(),
        durationMs: duration,
      },
    };
  }

  async getBoughtTogether(options: { itemId: string; limit: number }) {
    const startTime = Date.now();
    const { itemId, limit } = options;

    // Fetch the reference item
    const item = await this.catalogService.findById(itemId);

    if (!item) {
      return {
        items: [],
        message: 'Item not found',
      };
    }

    // --- Real co-purchase analysis from completed orders ---
    let coProductIds: string[] = [];
    let usedOrderData = false;

    try {
      // Find completed orders containing this product
      const orders = await this.orderModel.find({
        'items.product': new Types.ObjectId(itemId),
        status: 'completed',
      }).select('items.product').lean().limit(200);

      if (orders.length > 0) {
        // Count co-occurrence of other products in the same orders
        const coProductCounts = new Map<string, number>();
        for (const order of orders) {
          for (const orderItem of order.items) {
            const pid = orderItem.product.toString();
            if (pid !== itemId) {
              coProductCounts.set(pid, (coProductCounts.get(pid) || 0) + 1);
            }
          }
        }

        // Sort by co-occurrence frequency and take top results
        coProductIds = [...coProductCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit * 2)
          .map(([id]) => id);

        usedOrderData = coProductIds.length > 0;
      }
    } catch (e) {
      this.logger.warn(`Co-purchase analysis failed for ${itemId}: ${e.message}`);
    }

    // --- Fetch candidates: order-based or heuristic fallback ---
    let candidates: any[];

    if (usedOrderData && coProductIds.length >= limit) {
      // We have enough real co-purchase data
      candidates = await this.catalogService.findByIds(coProductIds);
    } else {
      // Fallback/supplement with vendor + tag heuristic
      const heuristicCandidates = await this.catalogService.findSimilar({
        excludeIds: [itemId, ...coProductIds],
        vendor: item.vendor,
        tags: item.tags,
        limit: limit * 3,
      });

      if (usedOrderData) {
        // Merge: order-based items first, then heuristic
        const orderItems = await this.catalogService.findByIds(coProductIds);
        candidates = [...orderItems, ...heuristicCandidates];
      } else {
        candidates = heuristicCandidates;
      }
    }

    // Score candidates in memory
    const scored = candidates.map((candidate, index) => {
      let score = 0;

      // If from order data, boost by position (first = highest co-occurrence)
      if (usedOrderData && coProductIds.includes(candidate.itemId)) {
        const orderRank = coProductIds.indexOf(candidate.itemId);
        score += 1.0 - (orderRank / coProductIds.length) * 0.5; // 1.0 to 0.5
      } else {
        // Heuristic scoring
        if (candidate.vendor === item.vendor) score += 0.3;
        const tagOverlap =
          item.tags?.filter((tag: string) => candidate.tags?.includes(tag)).length || 0;
        score += (tagOverlap / (item.tags?.length || 1)) * 0.3;
      }

      return { ...candidate, score };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Apply filtering and ranking
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
    const filterResult = this.filtersService.applyHardFilters(
      scored.slice(0, limit * 2),
      filterSpec,
      new Map(),
    );
    const ranked = this.rankersService.rankCandidates(filterResult.items, {});
    const finalItems = ranked.slice(0, limit);

    // Add explanations
    const results = finalItems.map((i) => {
      const explanation = this.explanationsService.generateExplanations(i, []);
      return {
        ...i,
        explanations: [
          usedOrderData ? 'Frequently bought together' : 'You might also like',
          ...explanation.texts,
        ],
        reasonCodes: ['BOUGHT_TOGETHER', ...explanation.codes],
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'Bought Together Stats',
      itemId,
      usedOrderData,
      ordersAnalyzed: usedOrderData ? 'yes' : 'no',
      candidatesFound: candidates.length,
      returned: results.length,
      durationMs: duration,
    });

    return {
      items: await this.hydrateWithProductData(results),
      referenceItem: {
        itemId: item.itemId,
        name: item.name,
      },
      debug: {
        usedOrderData,
        candidateCount: candidates.length,
        durationMs: duration,
      },
    };
  }

  async getCompleteTheLook(options: {
    itemIds: string[];
    userId?: string;
    limit: number;
  }) {
    const startTime = Date.now();
    const { itemIds, userId, limit } = options;

    // Fetch only the reference items (not entire catalog)
    const referenceItems = await this.catalogService.findByIds(itemIds);

    if (referenceItems.length === 0) {
      return {
        items: [],
        message: 'No reference items found',
      };
    }

    // Analyze what types of items are already in the look
    const existingTypes = new Set(referenceItems.map((i) => i.type));
    const existingVendors = new Set(referenceItems.map((i) => i.vendor));

    // Targeted query: find items of different types (not entire catalog)
    const candidates = await this.catalogService.findByTypesExcluding({
      excludeTypes: Array.from(existingTypes),
      excludeIds: itemIds,
      limit: limit * 3,
    });

    // Score candidates based on complementarity (small set now)
    const allTags = referenceItems.flatMap((r) => r.tags || []);
    const scored = candidates.map((candidate) => {
      let score = 0;

      // Prefer items from same vendors
      if (existingVendors.has(candidate.vendor)) score += 0.4;

      // Prefer items with tag overlap (style coherence)
      const tagOverlap =
        candidate.tags?.filter((tag) => allTags.includes(tag)).length || 0;
      if (tagOverlap > 0) score += 0.3 * (tagOverlap / allTags.length);

      // Prefer different types (always true since query excluded existing types)
      score += 0.3;

      return { ...candidate, score };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Apply user preferences if userId provided
    let finalCandidates = scored;
    if (userId) {
      try {
        const userVector =
          await this.userEmbeddingsService.getOrComputeUserStyleVector(userId);
        if (userVector) {
          // Use vector search to re-rank based on user preferences
          // For simplicity, just take the scored candidates
          finalCandidates = scored;
        }
      } catch (e) {
        this.logger.warn(
          'Failed to get user preferences for complete the look',
          e,
        );
      }
    }

    // Apply filtering and ranking
    const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
    const filterResult = this.filtersService.applyHardFilters(
      finalCandidates.slice(0, limit * 2),
      filterSpec,
      new Map(),
    );
    const ranked = this.rankersService.rankCandidates(filterResult.items, {});
    const finalItems = ranked.slice(0, limit);

    // Add explanations
    const results = finalItems.map((i) => {
      const explanation = this.explanationsService.generateExplanations(i, []);
      return {
        ...i,
        explanations: ['Completes your look', ...explanation.texts],
        reasonCodes: ['COMPLETE_LOOK', ...explanation.codes],
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log({
      msg: 'Complete the Look Stats',
      referenceItems: itemIds.length,
      candidatesFound: candidates.length,
      returned: results.length,
      durationMs: duration,
    });

    return {
      items: await this.hydrateWithProductData(results),
      referenceItems: referenceItems.map((i) => ({
        itemId: i.itemId,
        name: i.name,
        type: i.type,
      })),
      debug: {
        candidateCount: candidates.length,
        existingTypes: Array.from(existingTypes),
        durationMs: duration,
      },
    };
  }

  /**
   * Hydrate recommendation feed items with full product data from the products collection.
   * Maps CatalogItem.itemId → Product._id and merges product fields into the feed item.
   * The frontend gets everything it needs (images, business, clothing/fabric) in one call.
   */
  private async hydrateWithProductData(items: any[]): Promise<any[]> {
    if (!items.length) return items;

    // Extract itemIds and fetch full product documents
    const itemIds = items
      .map((i) => i.itemId)
      .filter((id) => Types.ObjectId.isValid(id));

    if (!itemIds.length) return items;

    const products = await this.productModel
      .find({
        _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) },
        status: 'active',
      })
      .populate('business', 'business_name business_logo_url accepts_external_fabric')
      .select(
        'name kind base_price business clothing fabric accessory status ' +
        'average_rating total_ratings slug',
      )
      .lean();

    // Build a lookup map: Product._id → Product
    const productMap = new Map(
      products.map((p: any) => [String(p._id), p]),
    );

    // Merge product data into feed items, dropping items without an active product
    return items
      .map((item) => {
        const product = productMap.get(item.itemId);
        if (!product) return null; // Skip: no matching active product

        return {
          // Recommendation metadata (keep)
          itemId: item.itemId,
          position: item.position,
          stream: item.stream,
          reasonCodes: item.reasonCodes,
          explanations: item.explanations,
          finalScore: item.finalScore,

          // Full product data (hydrated)
          product: {
            _id: product._id,
            name: product.name,
            kind: product.kind,
            base_price: product.base_price,
            business: product.business,
            clothing: product.clothing,
            fabric: product.fabric,
            accessory: product.accessory,
            average_rating: product.average_rating,
            total_ratings: product.total_ratings,
            slug: product.slug,
            status: product.status,
          },
        };
      })
      .filter(Boolean);
  }
}
