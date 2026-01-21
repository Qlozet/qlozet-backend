import { Injectable, Logger } from '@nestjs/common';
import { RankedItem } from '../rankers/rankers.service';
import { EventsService } from '../events/events.service';
import { Event } from '../events/schemas/event.schema';
import { ReasonCode } from '../enums/reason-code.enum';

@Injectable()
export class ExplanationsService {
    private readonly logger = new Logger(ExplanationsService.name);

    constructor(private eventsService: EventsService) { }

    generateExplanations(item: RankedItem, userHistory: Event[]): { texts: string[], codes: ReasonCode[] } {
        const texts: string[] = [];
        const codes: ReasonCode[] = [];

        // 1. Tag Match
        const topTags = this.getTopUserTags(userHistory);
        const matchingTags = item.tags?.filter(tag => topTags.includes(tag.toLowerCase()));

        if (matchingTags && matchingTags.length > 0) {
            texts.push(`Matches your interest in ${matchingTags.slice(0, 2).join(', ')}`);
            codes.push(ReasonCode.STYLE_MATCH);
        }

        // 2. High Similarity (Vector Score)
        const vScore = item.scoringDebug?.vScore;
        if (vScore && vScore > 0.85) {
            texts.push('Highly relevant to your style');
            codes.push(ReasonCode.AESTHETIC_MATCH);
        }

        // 3. Fast Delivery
        const etaDays = item.rawVendorData?.eta_days;
        if (etaDays !== undefined && etaDays <= 3) {
            texts.push('Fast Delivery');
            codes.push(ReasonCode.FAST_ETA);
        }

        // 4. Trusted Vendor
        const vendorQuality = item.rawVendorData?.vendorQuality; // or from calculated score
        // Checking calculated score directly usually safer if transient
        if ((item.scoringDebug?.vendorQuality || 0) > 0.7) {
            texts.push('Top Rated Vendor');
            codes.push(ReasonCode.TRUSTED_VENDOR);
        }

        // 5. Price Fit
        const priceFit = item.scoringDebug?.priceFit;
        // Check penalty? Or just check if it's well within?
        // Let's say if NOT penalized significantly and price matches budget
        if (!item.scoringDebug?.pricePenalty) {
            codes.push(ReasonCode.PRICE_FIT);
            // Verify implicit logic for text
            if (item.price > 0) texts.push('Within your budget');
        }

        return { texts, codes };
    }

    // Simplified helper: counts tags from recent events
    // In a real system, you'd aggregate this offline or cache it
    private getTopUserTags(events: Event[]): string[] {
        const tagCounts: Record<string, number> = {};

        // Note: Event schema saves generic 'properties'. We assume 'tags' might be logged there 
        // OR we would need to join with CatalogItems.
        // For this step, let's assume 'properties.tags' exists for simplicity or return empty if not available,
        // as fetching all items for history is expensive here.
        // Alternatively, we rely on what IS available.

        for (const event of events) {
            const tags = event.properties?.tags; // Hypothetical logging
            if (Array.isArray(tags)) {
                tags.forEach((t: string) => {
                    const norm = t.toLowerCase();
                    tagCounts[norm] = (tagCounts[norm] || 0) + 1;
                });
            }
        }

        return Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag]) => tag);
    }
}
