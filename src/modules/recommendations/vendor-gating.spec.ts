import { Test, TestingModule } from '@nestjs/testing';
import { FiltersService } from './filters/filters.service';
import { RankersService } from './rankers/rankers.service';
import { CatalogItem } from './catalog/schemas/catalog-item.schema';
import { FilterSpec } from './filters/dto/filter-spec.dto';

describe('Vendor Trust Gating', () => {
    let filtersService: FiltersService;
    let rankersService: RankersService;

    const mockItems: CatalogItem[] = [
        { itemId: '1', vendor: 'vendor_bad', price: 100 } as any,
        { itemId: '2', vendor: 'vendor_good', price: 100 } as any,
        { itemId: '3', vendor: 'vendor_featured', price: 100 } as any,
    ];

    const mockBusinesses = new Map<string, any>();
    mockBusinesses.set('vendor_bad', { is_active: false, status: 'rejected' });
    mockBusinesses.set('vendor_good', { is_active: true, status: 'approved', success_rate: 80 });
    mockBusinesses.set('vendor_featured', { is_active: true, status: 'verified', is_featured: true, success_rate: 95 });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [FiltersService, RankersService],
        }).compile();

        filtersService = module.get<FiltersService>(FiltersService);
        rankersService = module.get<RankersService>(RankersService);
    });

    describe('FiltersService', () => {
        it('should filter out inactive or rejected vendors', () => {
            const spec = new FilterSpec();
            const result = filtersService.applyHardFilters(mockItems, spec, mockBusinesses);
            const filtered = result.items;

            expect(filtered.length).toBe(2);
            expect(filtered.find(i => i.vendor === 'vendor_bad')).toBeUndefined();
            expect(filtered.find(i => i.vendor === 'vendor_good')).toBeDefined();
        });

        it('should allow all if businesses map is unavailable', () => {
            const spec = new FilterSpec();
            const result = filtersService.applyHardFilters(mockItems, spec, undefined);
            const filtered = result.items;
            expect(filtered.length).toBe(3);
        });
    });

    describe('RankersService', () => {
        it('should boost featured high-quality vendors', () => {
            const context = { businesses: mockBusinesses };
            const ranked = rankersService.rankCandidates([...mockItems], context);

            const featured = ranked.find(i => i.vendor === 'vendor_featured');
            const good = ranked.find(i => i.vendor === 'vendor_good');

            // Featured should have higher score due to boost + higher success rate
            expect(featured!.finalScore).toBeGreaterThan(good!.finalScore);
            expect(featured!.scoringDebug.vendorQualityScore).toBeGreaterThan(0.5);
            expect(featured!.scoringDebug.vendorBoost).toBeGreaterThan(0);
        });
    });
});
