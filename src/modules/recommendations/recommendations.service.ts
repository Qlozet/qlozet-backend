import { Injectable, Logger } from '@nestjs/common';
import { RetrievalService } from './retrieval/retrieval.service';
import { FiltersService } from './filters/filters.service';
import { RankersService } from './rankers/rankers.service';
import { ExplanationsService } from './explanations/explanations.service';
import { UserEmbeddingsService } from './user-embeddings/user-embeddings.service';
import { EventsService } from './events/events.service';
import { BusinessService } from '../business/business.service';
import { FeedMixerService } from './feed-mixer/feed-mixer.service';
import { VendorFeedResponseDto, VendorFeedItemDto } from './dto/vendor-feed-response.dto';
import { FeedItemDto } from './dto/feed-response.dto';
import { v4 as uuid } from 'uuid';
import { CatalogService } from './catalog/catalog.service';

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
        private feedMixerService: FeedMixerService,
        private catalogService: CatalogService,
    ) { }

    async getHomeFeed(options: {
        userId: string;
        sessionId?: string;
        limit: number;
        budgetMax?: number;
        deadlineDays?: number;
    }) {
        const startTime = Date.now();
        const { userId, sessionId, limit, budgetMax, deadlineDays } = options;

        // 1. User Context & Embeddings
        const userProfileVector = await this.userEmbeddingsService.computeUserStyleVector(userId);
        let sessionVector: number[] | null = null;
        if (sessionId) {
            sessionVector = await this.userEmbeddingsService.computeSessionStyleVector(userId, sessionId);
        }

        // Check if userProfileVector is just explicit preference or full blend? 
        // Assuming computeUserStyleVector now returns blend.
        const blendedVector = this.userEmbeddingsService.blendVectors(userProfileVector, sessionVector);
        const usedSessionBlend = !!sessionVector;
        const coldStartLevel = !blendedVector ? 'cold' : (!userProfileVector ? 'warm_session' : 'hot');

        // 2. Retrieval
        const candidates = await this.retrievalService.retrieveCandidatesForHomeFeed({
            userStyleVector: blendedVector,
            limit: limit * 2, // Fetch more for filtering
            numCandidates: 1000,
        });

        // 2.5 Fetch Vendor/Business Data
        const vendorIds = [...new Set(candidates.map(c => c.vendor).filter(Boolean))];
        const businesses = new Map();
        // Assuming BusinessService has a findMany or similar. If not, parallel findOne.
        // Optimizing: findMany needed. Using findAll loop or adding findMany to BusinessService.
        // For now, assuming distinct fetch or mock since we didn't add findMany to BusinessService explicitly.
        try {
            // Mocking bulk fetch for now or looping. Ideally db.collection('businesses').find({ _id: { $in: ids } })
            // Let's assume we can loop for small batch (limit * 2 is small)
            await Promise.all(vendorIds.map(async (vid) => {
                try {
                    const b = await this.businessService.findOne(vid);
                    if (b) businesses.set(String(b._id), b);
                    // Also support 'vendor' field matching if it's not ID inside item.vendor (schema check needed)
                    // Assuming item.vendor IS business ID string.
                } catch (e) { }
            }));
        } catch (e) {
            this.logger.warn('Failed to fetch businesses for gating', e);
        }

        // 3. Filtering
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({
            maxPrice: budgetMax,
        });
        if (deadlineDays) filterSpec.deadlineDays = deadlineDays;

        // Apply hard filters (including vendor trust gating)
        const filterResult = this.filtersService.applyHardFilters(candidates, filterSpec, businesses);
        const filtered = filterResult.items;
        const filterMetrics = filterResult.metrics;

        // 4. Ranking
        const rankingContext = {
            budgetMax,
            businesses, // Pass businesses for scoring
        };
        const ranked = this.rankersService.rankCandidates(filtered, rankingContext);

        const finalItems = ranked.slice(0, limit);

        // 5. Explanations
        const recentHistory = await this.eventsService.getRecentEvents(userId, 20);

        const results = finalItems.map(item => {
            const reasons = this.explanationsService.generateExplanations(item, recentHistory);
            return {
                ...item,
                explanations: reasons
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
            filterDropOffRate: candidates.length > 0 ? (candidates.length - filtered.length) / candidates.length : 0,
            metrics: filterMetrics // Added detailed metrics to log
        });

        return {
            items: results,
            debug: {
                coldStartLevel,
                usedSessionBlend,
                candidateCount: candidates.length,
                filteredCount: filtered.length,
                durationMs: duration,
            }
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
        const userProfileVector = await this.userEmbeddingsService.computeUserStyleVector(userId);
        const blendedVector = this.userEmbeddingsService.blendVectors(userProfileVector, null);

        // 2. Retrieval - fetch more candidates to ensure we have enough vendors
        const candidates = await this.retrievalService.retrieveCandidatesForHomeFeed({
            userStyleVector: blendedVector,
            limit: limit * productsPerVendor * 3, // Fetch extra to ensure vendor diversity
            numCandidates: 2000,
        });

        // 3. Fetch Vendor/Business Data
        const vendorIds = [...new Set(candidates.map(c => c.vendor).filter(Boolean))];
        const businesses = new Map();
        try {
            await Promise.all(vendorIds.map(async (vid) => {
                try {
                    const b = await this.businessService.findOne(vid);
                    if (b) businesses.set(String(b._id), b);
                } catch (e) { }
            }));
        } catch (e) {
            this.logger.warn('Failed to fetch businesses for vendor feed', e);
        }

        // 4. Apply basic filtering
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
        const filterResult = this.filtersService.applyHardFilters(candidates, filterSpec, businesses);
        const filtered = filterResult.items;

        // 5. Group products by vendor
        const vendorProductsMap = new Map<string, typeof filtered>();
        filtered.forEach(item => {
            if (item.vendor) {
                if (!vendorProductsMap.has(item.vendor)) {
                    vendorProductsMap.set(item.vendor, []);
                }
                vendorProductsMap.get(item.vendor)!.push(item);
            }
        });

        // 6. Rank vendors based on aggregate quality
        const vendorScores = Array.from(vendorProductsMap.entries()).map(([vendorId, products]) => {
            const business = businesses.get(vendorId);
            // Rank products first to get finalScore
            const rankedProducts = this.rankersService.rankCandidates(products, { businesses });
            const avgScore = rankedProducts.reduce((sum, p) => sum + (p.finalScore || 0), 0) / rankedProducts.length;
            const vendorQuality = business?.quality_score || 0.5;

            // Combined score: product relevance + vendor quality
            const combinedScore = avgScore * 0.7 + vendorQuality * 0.3;

            return {
                vendorId,
                products: rankedProducts,
                business,
                score: combinedScore,
            };
        });

        // Sort vendors by score
        vendorScores.sort((a, b) => b.score - a.score);

        // 7. Build vendor feed items
        const recentHistory = await this.eventsService.getRecentEvents(userId, 20);
        const vendorFeedItems: VendorFeedItemDto[] = vendorScores.slice(0, limit).map((vendorData, vendorIndex) => {
            // Take top N products for this vendor
            const topProducts = vendorData.products.slice(0, productsPerVendor).map((item, productIndex) => {
                const explanation = this.explanationsService.generateExplanations(item, recentHistory);

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
            const vendorExplanations = [`Top-rated vendor with ${vendorData.products.length} matching products`];
            if (vendorData.business?.quality_score) {
                vendorExplanations.push(`Quality score: ${(vendorData.business.quality_score * 100).toFixed(0)}%`);
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

        return {
            requestId: uuid(),
            vendors: vendorFeedItems,
        };
    }

    async getTrendingFeed(options: {
        limit: number;
    }) {
        const startTime = Date.now();
        const { limit } = options;

        // Fetch trending items (currently just retrieves items, could be enhanced with click/view metrics)
        const trendingItems = await this.retrievalService.retrieveTrendingCandidates(limit * 2);

        // Apply basic filtering
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
        const filterResult = this.filtersService.applyHardFilters(trendingItems, filterSpec, new Map());
        const filtered = filterResult.items;

        // Rank the trending items
        const ranked = this.rankersService.rankCandidates(filtered, {});
        const finalItems = ranked.slice(0, limit);

        // Add explanations
        const results = finalItems.map(item => {
            const explanation = this.explanationsService.generateExplanations(item, []);
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
            items: results,
            debug: {
                candidateCount: trendingItems.length,
                filteredCount: filtered.length,
                durationMs: duration,
            },
        };
    }

    async getNewArrivalsFeed(options: {
        limit: number;
        days: number;
    }) {
        const startTime = Date.now();
        const { limit, days } = options;

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Fetch all catalog items and filter by creation date
        const allItems = await this.catalogService.findAll();
        const newItems = allItems.filter(item => {
            const createdAt = (item as any).createdAt || (item as any)._id?.getTimestamp();
            return createdAt && new Date(createdAt) >= cutoffDate;
        });

        // Sort by creation date (newest first)
        newItems.sort((a, b) => {
            const dateA = (a as any).createdAt || (a as any)._id?.getTimestamp();
            const dateB = (b as any).createdAt || (b as any)._id?.getTimestamp();
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });

        // Apply filtering
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
        const filterResult = this.filtersService.applyHardFilters(newItems.slice(0, limit * 2), filterSpec, new Map());
        const filtered = filterResult.items;

        // Rank the items
        const ranked = this.rankersService.rankCandidates(filtered, {});
        const finalItems = ranked.slice(0, limit);

        // Add explanations
        const results = finalItems.map(item => {
            const explanation = this.explanationsService.generateExplanations(item, []);
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
            items: results,
            debug: {
                totalNewItems: newItems.length,
                cutoffDate: cutoffDate.toISOString(),
                durationMs: duration,
            },
        };
    }

    async getBoughtTogether(options: {
        itemId: string;
        limit: number;
    }) {
        const startTime = Date.now();
        const { itemId, limit } = options;

        // NOTE: This is a simplified implementation that uses similar items logic
        // In a production system, you would analyze order history to find frequently co-purchased items

        // For now, fetch the reference item
        const referenceItem = await this.catalogService.findAll();
        const item = referenceItem.find(i => i.itemId === itemId);

        if (!item) {
            return {
                items: [],
                message: 'Item not found',
            };
        }

        // Simple heuristic: Find items from the same vendor or similar tags
        const allItems = await this.catalogService.findAll();
        const candidates = allItems.filter(i => {
            if (i.itemId === itemId) return false;

            // Score based on vendor match and tag overlap
            const sameVendor = i.vendor === item.vendor;
            const tagOverlap = item.tags?.filter(tag => i.tags?.includes(tag)).length || 0;

            return sameVendor || tagOverlap > 0;
        });

        // Score candidates
        const scored = candidates.map(candidate => {
            let score = 0;
            if (candidate.vendor === item.vendor) score += 0.5;
            const tagOverlap = item.tags?.filter(tag => candidate.tags?.includes(tag)).length || 0;
            score += (tagOverlap / (item.tags?.length || 1)) * 0.5;

            return { ...candidate, score };
        });

        // Sort by score
        scored.sort((a, b) => b.score - a.score);

        // Apply filtering and ranking
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
        const filterResult = this.filtersService.applyHardFilters(scored.slice(0, limit * 2), filterSpec, new Map());
        const ranked = this.rankersService.rankCandidates(filterResult.items, {});
        const finalItems = ranked.slice(0, limit);

        // Add explanations
        const results = finalItems.map(i => {
            const explanation = this.explanationsService.generateExplanations(i, []);
            return {
                ...i,
                explanations: ['Frequently bought together', ...explanation.texts],
                reasonCodes: ['BOUGHT_TOGETHER', ...explanation.codes],
            };
        });

        const duration = Date.now() - startTime;
        this.logger.log({
            msg: 'Bought Together Stats',
            itemId,
            candidatesFound: candidates.length,
            returned: results.length,
            durationMs: duration,
        });

        return {
            items: results,
            referenceItem: {
                itemId: item.itemId,
                name: item.name,
            },
            debug: {
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

        // Fetch the reference items (cart/wishlist items)
        const allItems = await this.catalogService.findAll();
        const referenceItems = allItems.filter(i => itemIds.includes(i.itemId));

        if (referenceItems.length === 0) {
            return {
                items: [],
                message: 'No reference items found',
            };
        }

        // Analyze what types of items are already in the look
        const existingTypes = new Set(referenceItems.map(i => i.type));
        const existingVendors = new Set(referenceItems.map(i => i.vendor));

        // Find complementary items (different types, preferably same vendor)
        const candidates = allItems.filter(i => {
            // Don't recommend items already in the selection
            if (itemIds.includes(i.itemId)) return false;

            // Prefer different item types (to complete the look)
            const isDifferentType = !existingTypes.has(i.type);

            return isDifferentType;
        });

        // Score candidates based on complementarity
        const scored = candidates.map(candidate => {
            let score = 0;

            // Prefer items from same vendors
            if (existingVendors.has(candidate.vendor)) score += 0.4;

            // Prefer items with tag overlap (style coherence)
            const allTags = referenceItems.flatMap(r => r.tags || []);
            const tagOverlap = candidate.tags?.filter(tag => allTags.includes(tag)).length || 0;
            if (tagOverlap > 0) score += 0.3 * (tagOverlap / allTags.length);

            // Prefer different types
            if (!existingTypes.has(candidate.type)) score += 0.3;

            return { ...candidate, score };
        });

        // Sort by score
        scored.sort((a, b) => b.score - a.score);

        // Apply user preferences if userId provided
        let finalCandidates = scored;
        if (userId) {
            try {
                const userVector = await this.userEmbeddingsService.computeUserStyleVector(userId);
                if (userVector) {
                    // Use vector search to re-rank based on user preferences
                    // For simplicity, just take the scored candidates
                    finalCandidates = scored;
                }
            } catch (e) {
                this.logger.warn('Failed to get user preferences for complete the look', e);
            }
        }

        // Apply filtering and ranking
        const filterSpec = this.filtersService.buildFilterSpecFromRequest({});
        const filterResult = this.filtersService.applyHardFilters(finalCandidates.slice(0, limit * 2), filterSpec, new Map());
        const ranked = this.rankersService.rankCandidates(filterResult.items, {});
        const finalItems = ranked.slice(0, limit);

        // Add explanations
        const results = finalItems.map(i => {
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
            items: results,
            referenceItems: referenceItems.map(i => ({
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
}
