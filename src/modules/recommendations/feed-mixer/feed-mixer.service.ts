import { Injectable, Logger } from '@nestjs/common';
import { RankedItem } from '../rankers/rankers.service';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

@Injectable()
export class FeedMixerService {
    private readonly logger = new Logger(FeedMixerService.name);
    private readonly PATTERN = ['C', 'C', 'A', 'C', 'C', 'F'];
    // C=Garment, A=Accessory, F=Fabric
    // Ratio roughly: 4 C, 1 A, 1 F -> 66% C, 16% A, 16% F in simplest cycle
    // Adjusted pattern to match exact 60/25/15 requires larger cycle or probabilistic
    // "60% clothing, 25% accessory, 15% fabric" -> 12/5/3 in 20 items. 
    // Simple cycle C,C,C,A,F isn't quite right.
    // The prompting asked for: ["C","C","A","C","C","F"] repeating.
    // That gives 4 C (66%), 1 A (16.7%), 1 F (16.7%). 
    // Close enough to start, or we respect the EXACT prompt pattern.

    private readonly MAX_PER_VENDOR_TOP_10 = 2;

    mixCandidates(
        garments: RankedItem[],
        accessories: RankedItem[],
        fabrics: RankedItem[],
        limit: number
    ): RankedItem[] {
        const mixed: RankedItem[] = [];
        const seenIds = new Set<string>();
        const vendorCountsTop10 = new Map<string, number>();

        // We'll consume from queues
        let gIdx = 0, aIdx = 0, fIdx = 0;

        // Helper to get next valid item from a specific pool
        const getNext = (pool: RankedItem[]): RankedItem | null => {
            // Find next item that hasn't been seen
            // Note: Since each pool is distinct by type, ID collision is unlikely between pools unless data error,
            // but duplications checks are safe.
            let idx = pool === garments ? gIdx : (pool === accessories ? aIdx : fIdx);

            while (idx < pool.length) {
                const item = pool[idx];
                idx++;
                // Update pointers
                if (pool === garments) gIdx = idx;
                else if (pool === accessories) aIdx = idx;
                else fIdx = idx;

                const id = item.itemId;
                if (seenIds.has(id)) continue;

                // Vendor Check for Top 10
                if (mixed.length < 10) {
                    const vCount = vendorCountsTop10.get(item.vendor) || 0;
                    if (vCount >= this.MAX_PER_VENDOR_TOP_10) {
                        // Skip this item for top 10 slot? 
                        // Prompt says "cap: max 2 items per vendor in top 10".
                        // Use a side buffer for deferred items? Or simply skip.
                        // Skipping is safer for diversity.
                        continue;
                    }
                    vendorCountsTop10.set(item.vendor, vCount + 1);
                }

                seenIds.add(id);
                return item;
            }
            return null;
        };

        let pIdx = 0;
        while (mixed.length < limit) {
            const typeCode = this.PATTERN[pIdx % this.PATTERN.length];
            let item: RankedItem | null = null;

            if (typeCode === 'C') item = getNext(garments);
            else if (typeCode === 'A') item = getNext(accessories);
            else if (typeCode === 'F') item = getNext(fabrics);

            // Fallback: If preferred type empty, try others in priority Order: C -> A -> F
            if (!item) {
                if (typeCode !== 'C') item = getNext(garments);
                if (!item && typeCode !== 'A') item = getNext(accessories);
                if (!item && typeCode !== 'F') item = getNext(fabrics);
            }

            if (!item) break; // No items left at all

            (item as any).stream = (item.type === CatalogItemType.GARMENT) ? 'clothing' :
                (item.type === CatalogItemType.ACCESSORY) ? 'accessory' : 'fabric';
            mixed.push(item);
            pIdx++;
        }

        return mixed;
    }
}
