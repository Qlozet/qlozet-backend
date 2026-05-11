import { Injectable, Logger } from '@nestjs/common';
import { VectorSearchService } from './vector-search.service';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';

@Injectable()
export class RetrievalService {
    private readonly logger = new Logger(RetrievalService.name);

    constructor(
        private vectorSearchService: VectorSearchService,
        private catalogService: CatalogService,
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

    async retrieveTrendingCandidates(limit: number): Promise<CatalogItem[]> {
        // Placeholder: In a real system, you'd sort by click_count_7d desc
        // Here we just fetch recent items from CatalogService
        const allItems = await this.catalogService.findAll();
        return allItems.slice(0, limit);
    }
}
