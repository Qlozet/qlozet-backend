import { Test, TestingModule } from '@nestjs/testing';
import { FiltersService } from './filters.service';
import { FilterSpec } from './dto/filter-spec.dto';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

describe('FiltersService', () => {
    let service: FiltersService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [FiltersService],
        }).compile();

        service = module.get<FiltersService>(FiltersService);
    });

    describe('applyHardFilters', () => {
        const items: Partial<CatalogItem>[] = [
            { itemId: '1', price: 100, vendor: 'Nike', type: CatalogItemType.GARMENT, fitMeta: { targetDemographic: 'mens', fitType: 'slim', measurementsPoints: [] }, rawVendorData: { inventory_quantity: 10 } },
            { itemId: '2', price: 50, vendor: 'Adidas', type: CatalogItemType.GARMENT, fitMeta: { targetDemographic: 'womens', fitType: 'regular', measurementsPoints: [] }, rawVendorData: { inventory_quantity: 0 } },
            { itemId: '3', price: 200, vendor: 'Gucci', type: CatalogItemType.ACCESSORY, rawVendorData: { inventory_quantity: 5 } },
        ];

        it('should filter by max price', () => {
            const spec = new FilterSpec();
            spec.maxPrice = 150;
            spec.inStockOnly = false; // Disable default stock filtering
            const result = service.applyHardFilters(items as CatalogItem[], spec);
            const filtered = result.items;
            // Items 1 (100) and 2 (50) should pass, item 3 (200) should be filtered out
            expect(filtered.length).toBe(2);
            expect(filtered.map(i => i.itemId)).toContain('1');
            expect(filtered.map(i => i.itemId)).toContain('2');
        });

        it('should filter out of stock', () => {
            const spec = new FilterSpec();
            spec.inStockOnly = true;
            const result = service.applyHardFilters(items as CatalogItem[], spec);
            const filtered = result.items;
            expect(filtered.length).toBe(2);
            expect(filtered.map(i => i.itemId)).toEqual(['1', '3']);
        });

        it('should filter by gender', () => {
            const spec = new FilterSpec();
            spec.gender = 'mens';
            const result = service.applyHardFilters(items as CatalogItem[], spec);
            const filtered = result.items;
            // Item 1 (mens) + Item 3 (Accessory, no fitMeta so implied unisex/all unless strict)
            // Logic check: if fitMeta exists, check it. If not, pass or fail? Implementation passed it.
            expect(filtered.length).toBe(2);
            expect(filtered.find(i => i.itemId === '2')).toBeUndefined();
        });

        it('should filter blocked vendors', () => {
            const spec = new FilterSpec();
            spec.blockedVendors = ['Gucci'];
            spec.inStockOnly = false; // Disable default stock filtering
            const result = service.applyHardFilters(items as CatalogItem[], spec);
            const filtered = result.items;
            expect(filtered.length).toBe(2);
            expect(filtered.find(i => i.itemId === '3')).toBeUndefined();
        });
    });
});
