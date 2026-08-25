import { Injectable, Logger } from '@nestjs/common';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { FilterSpec } from './dto/filter-spec.dto';

@Injectable()
export class FiltersService {
    private readonly logger = new Logger(FiltersService.name);

    /**
     * Normalize gender/demographic values to a canonical token so the feed's
     * request gender (male/female) matches the catalog's targetDemographic
     * (men/women/mens/womens). Without this the recommendation feed dropped
     * every gendered garment and only surfaced unisex items.
     */
    private normalizeGender(value?: string): string {
        const s = (value || '').toLowerCase().trim();
        if (['male', 'man', 'men', 'mens', "men's", 'm'].includes(s)) return 'men';
        if (['female', 'woman', 'women', 'womens', "women's", 'f'].includes(s)) return 'women';
        return s; // 'unisex' or unknown → left as-is
    }

    buildFilterSpecFromRequest(query: any, userProfile?: any): FilterSpec {
        const spec = new FilterSpec();

        if (query.maxPrice) spec.maxPrice = parseFloat(query.maxPrice);
        if (query.gender) spec.gender = query.gender;
        if (query.category) spec.category = query.category;
        if (query.inStockOnly !== undefined) spec.inStockOnly = query.inStockOnly === 'true';

        // Example: Block vendors from user profile settings
        if (userProfile?.blockedVendors) {
            spec.blockedVendors = userProfile.blockedVendors;
        }

        return spec;
    }

    applyHardFilters(items: CatalogItem[], spec: FilterSpec, businesses?: Map<string, any>): { items: CatalogItem[], metrics: Record<string, number> } {
        const metrics: Record<string, number> = {
            total_input: items.length,
            dropped_vendor_gating: 0,
            dropped_stock: 0,
            dropped_price: 0,
            dropped_blocked_vendor: 0,
            dropped_demographic: 0,
            dropped_category: 0,
            total_output: 0,
        };

        const filtered = items.filter(item => {
            // 0. Vendor Trust Gating
            if (businesses) {
                const business = businesses.get(item.vendor);
                if (business) {
                    if (business.is_active === false) {
                        metrics.dropped_vendor_gating++;
                        return false;
                    }
                    if (business.status && !['approved', 'verified'].includes(business.status)) {
                        metrics.dropped_vendor_gating++;
                        return false;
                    }
                }
            }

            // 1. Stock Check
            if (spec.inStockOnly) {
                const stock = item.rawVendorData?.inventory_quantity;
                if (stock !== undefined && stock <= 0) {
                    metrics.dropped_stock++;
                    return false;
                }
            }

            // 2. Price Check
            if (spec.maxPrice !== undefined && item.price > spec.maxPrice) {
                metrics.dropped_price++;
                return false;
            }

            // 3. Blocked Vendors
            if (spec.blockedVendors && spec.blockedVendors.includes(item.vendor)) {
                metrics.dropped_blocked_vendor++;
                return false;
            }

            // 4. Gender / Demographic (synonym-aware: male↔men, female↔women)
            if (spec.gender && item.fitMeta?.targetDemographic) {
                const target = this.normalizeGender(item.fitMeta.targetDemographic);
                const want = this.normalizeGender(spec.gender);
                if (target !== 'unisex' && target !== want) {
                    metrics.dropped_demographic++;
                    return false;
                }
            }

            // 5. Category
            if (spec.category) {
                const cat = spec.category.toLowerCase();
                const matchesType = item.type.toLowerCase() === cat;
                const matchesTags = item.tags?.some(t => t.toLowerCase() === cat);
                if (!matchesType && !matchesTags) {
                    metrics.dropped_category++;
                    return false;
                }
            }

            return true;
        });

        metrics.total_output = filtered.length;
        // Ideally log metrics here or return them for upper layer to log
        // this.logger.debug(`Filter Metrics: ${JSON.stringify(metrics)}`);

        return { items: filtered, metrics };
    }
}
