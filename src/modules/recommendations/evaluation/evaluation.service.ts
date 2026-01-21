import { Injectable, Logger } from '@nestjs/common';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { Event } from '../events/schemas/event.schema';
import { EventType } from '../events/enums/event-type.enum';

export interface EvaluationMetrics {
    ctrAtK: number;
    conversionAtK: number;
    diversity: {
        uniqueVendors: number;
        uniqueCategories: number;
    };
}

@Injectable()
export class EvaluationService {
    private readonly logger = new Logger(EvaluationService.name);

    computeMetrics(
        recommendations: CatalogItem[],
        groundTruthEvents: Event[],
        k: number = 10,
    ): EvaluationMetrics {
        const topK = recommendations.slice(0, k);
        const topKIds = new Set(topK.map(item => item.itemId));

        // 1. CTR@K Proxy (Matches with CLICK events)
        // We count how many of the top K items appear in the user's CLICK events *after* the recommendation point ideally.
        // here we assume groundTruthEvents are the relevant "future" events or hold-out set.
        const clicks = groundTruthEvents.filter(e => e.eventType === EventType.CLICK_ITEM);
        const clickMatches = clicks.filter(e => e.properties?.itemId && topKIds.has(e.properties.itemId));
        const ctrAtK = clicks.length > 0 ? clickMatches.length / clicks.length : 0; // Or standard Precision@K: matches / k

        // 2. Conversion@K (ADD_TO_CART / PURCHASE)
        const conversions = groundTruthEvents.filter(e =>
            e.eventType === EventType.ADD_TO_CART || e.eventType === EventType.PURCHASE
        );
        const conversionMatches = conversions.filter(e => e.properties?.itemId && topKIds.has(e.properties.itemId));
        const conversionAtK = conversions.length > 0 ? conversionMatches.length / conversions.length : 0;

        // 3. Diversity
        const uniqueVendors = new Set(topK.map(i => i.vendor)).size;
        const uniqueCategories = new Set(topK.map(i => i.type)).size;

        return {
            ctrAtK,
            conversionAtK,
            diversity: {
                uniqueVendors,
                uniqueCategories,
            },
        };
    }

    evaluateSession(recommendations: CatalogItem[], events: Event[]): EvaluationMetrics {
        return this.computeMetrics(recommendations, events, recommendations.length);
    }
}
