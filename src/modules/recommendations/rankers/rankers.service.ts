import { Injectable, Logger } from '@nestjs/common';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';

export interface RankingContext {
    budgetMax?: number;
    businesses?: Map<string, any>;
    // userProfile info could go here
}

export interface RankedItem extends CatalogItem {
    finalScore: number;
    scoringDebug?: any;
}

@Injectable()
export class RankersService {
    private readonly logger = new Logger(RankersService.name);

    rankCandidates(items: CatalogItem[], context: RankingContext): RankedItem[] {
        return items.map(item => this.scoreItem(item, context))
            .sort((a, b) => b.finalScore - a.finalScore);
    }

    private scoreItem(item: CatalogItem, context: RankingContext): RankedItem {
        // 1. Vector Score (Passed from retrieval, or default 0.5)
        const vScore = (item as any).score || 0.5;

        // 2. Vendor Quality (Mock or from raw data or business records)
        let vendorQualityScore = item.rawVendorData?.vendorQuality || 0.8;
        let vendorBoost = 0;

        // Overlay with live business gating/trust data if available
        if (context.businesses) {
            const business = context.businesses.get(item.vendor);
            if (business) {
                // success_rate 0-100 -> 0-1
                if (business.success_rate !== undefined) {
                    vendorQualityScore = business.success_rate / 100;
                }
                // Feature boost
                if (business.is_featured) {
                    vendorBoost = 0.2;
                }
            }
        }

        // 3. ETA (Mock or from raw data)
        const etaDays = item.rawVendorData?.eta_days || 3;
        const etaScore = 1 / (etaDays + 1);

        // 4. Price Fit
        let priceFit = 1;
        if (context.budgetMax) {
            if (item.price <= context.budgetMax) {
                priceFit = 1;
            } else {
                priceFit = context.budgetMax / item.price;
            }
        }

        // Formula: 0.70*vScore + 0.15*vendorQuality + 0.10*etaScore + 0.05*priceFit + boost
        const finalScore =
            (0.70 * vScore) +
            (0.15 * vendorQualityScore) +
            (0.10 * etaScore) +
            (0.05 * priceFit) +
            vendorBoost;

        return {
            ...item,
            finalScore,
            scoringDebug: { vScore, vendorQualityScore, etaScore, priceFit, vendorBoost }
        };
    }
}
