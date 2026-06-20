import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VectorSearchService } from './vector-search.service';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { Event, EventDocument } from '../events/schemas/event.schema';

@Injectable()
export class RetrievalService {
    private readonly logger = new Logger(RetrievalService.name);

    constructor(
        private vectorSearchService: VectorSearchService,
        private catalogService: CatalogService,
        @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    ) { }

    async retrieveCandidatesForHomeFeed(options: {
        userStyleVector?: number[] | null;
        limit?: number;
        numCandidates?: number;
        filters?: any;
    }): Promise<CatalogItem[]> {
        const { userStyleVector, limit = 150, numCandidates = 1000, filters } = options;
        const candidates = new Map<string, CatalogItem>();

        // 1. Personalized Vector Search
        if (userStyleVector) {
            try {
                const vectorResults = await this.vectorSearchService.search(
                    userStyleVector,
                    'items_style_vindex',
                    limit, // Fetch roughly the limit from vector search
                    numCandidates,
                    filters,
                );
                vectorResults.forEach((item) => candidates.set(item.itemId || item._id.toString(), item));
            } catch (e) {
                this.logger.error(`Vector search failed, falling back: ${e.message}`);
            }
        }

        // 2. Trending / Fallback Candidates
        // If we don't have enough candidates, fill with trending
        if (candidates.size < limit) {
            const remaining = limit - candidates.size;
            const trending = await this.retrieveTrendingCandidates(remaining * 2); // Fetch more to avoid overlapping dupes
            trending.forEach((item) => {
                const id = item.itemId || (item as any)._id.toString();
                if (!candidates.has(id)) {
                    candidates.set(id, item);
                }
            });
        }

        // Convert map to array and trim to limit
        return Array.from(candidates.values()).slice(0, limit);
    }

    /**
     * Retrieve trending items based on real engagement events from the last 7 days.
     * Weighted scoring: purchase(5) > add_to_cart(3) > save(2) > click(1) > view(0.5)
     * Falls back to recent catalog items if no events exist.
     */
    async retrieveTrendingCandidates(limit: number): Promise<CatalogItem[]> {
        try {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            // Aggregate engagement events by item with weighted scoring
            const trending = await this.eventModel.aggregate([
                {
                    $match: {
                        timestamp: { $gte: sevenDaysAgo },
                        eventType: {
                            $in: ['click_item', 'view_item', 'add_to_cart', 'purchase', 'save_item'],
                        },
                        'properties.itemId': { $exists: true, $ne: null },
                    },
                },
                {
                    $group: {
                        _id: '$properties.itemId',
                        score: {
                            $sum: {
                                $switch: {
                                    branches: [
                                        { case: { $eq: ['$eventType', 'purchase'] }, then: 5 },
                                        { case: { $eq: ['$eventType', 'add_to_cart'] }, then: 3 },
                                        { case: { $eq: ['$eventType', 'save_item'] }, then: 2 },
                                        { case: { $eq: ['$eventType', 'click_item'] }, then: 1 },
                                        { case: { $eq: ['$eventType', 'view_item'] }, then: 0.5 },
                                    ],
                                    default: 0,
                                },
                            },
                        },
                        uniqueUsers: { $addToSet: '$userId' },
                    },
                },
                {
                    $addFields: {
                        uniqueUserCount: { $size: '$uniqueUsers' },
                    },
                },
                { $sort: { score: -1 } },
                { $limit: limit },
                { $project: { _id: 1, score: 1, uniqueUserCount: 1 } },
            ]).exec();

            if (trending.length > 0) {
                const itemIds = trending.map((t) => t._id);
                const items = await this.catalogService.findByIds(itemIds);

                // Preserve the trending order (highest score first)
                const itemMap = new Map(items.map((item) => [item.itemId, item]));
                const ordered = itemIds
                    .map((id) => itemMap.get(id))
                    .filter((item) => !!item) as CatalogItem[];

                this.logger.debug(`Trending: found ${ordered.length} items from ${trending.length} event groups`);
                return ordered;
            }
        } catch (e) {
            this.logger.warn(`Event-based trending failed, using fallback: ${e.message}`);
        }

        // Fallback: recent items from catalog (no events yet)
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        return this.catalogService.findRecent(cutoff, limit);
    }
}

