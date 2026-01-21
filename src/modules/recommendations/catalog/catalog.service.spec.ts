import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { getModelToken } from '@nestjs/mongoose';
import { CatalogItem as CatalogItemEntity } from './schemas/catalog-item.schema';
import { CatalogItemType } from './enums/catalog-item-type.enum';

class MockCatalogModel {
    constructor(private data: any) { Object.assign(this, data); }
    save = jest.fn().mockResolvedValue(this);
}

describe('CatalogService', () => {
    let service: CatalogService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CatalogService,
                {
                    provide: getModelToken(CatalogItemEntity.name),
                    useValue: MockCatalogModel,
                },
            ],
        }).compile();

        service = module.get<CatalogService>(CatalogService);
    });

    describe('normalizeVendorListing', () => {
        it('should normalize Shopify CSV data', () => {
            const raw = {
                Handle: 't-shirt-001',
                Title: 'Cotton T-Shirt',
                Body_HTML: '<p>Comfortable cotton</p>',
                Variant_Price: '29.99',
                Tags: 'summer, casual',
                'Option1 Value': 'slim',
            };
            const result = service.normalizeVendorListing(raw, 'shopify_csv');

            expect(result.itemId).toBe('t-shirt-001');
            expect(result.name).toBe('Cotton T-Shirt');
            expect(result.price).toBe(29.99);
            expect(result.type).toBe(CatalogItemType.GARMENT);
            expect(result.fitMeta?.fitType).toBe('slim');
            expect(result.tags).toContain('summer');
        });

        it('should normalize Custom API data (Fabric)', () => {
            const raw = {
                id: 'fab-123',
                productName: 'Silk Sheet',
                category: 'Fabrics',
                cost: 100,
                currencyCode: 'GBP',
                materialInfo: '100% Silk',
            };
            const result = service.normalizeVendorListing(raw, 'custom_api');

            expect(result.itemId).toBe('fab-123');
            expect(result.type).toBe(CatalogItemType.FABRIC);
            expect(result.currency).toBe('GBP');
            expect(result.material).toBe('100% Silk');
        });

        it('should fallback to generic normalization', () => {
            const raw = {
                sku: 'gen-999',
                title: 'Generic Item',
                price: 50,
            };
            const result = service.normalizeVendorListing(raw, 'unknown_source');

            expect(result.itemId).toBe('gen-999');
            expect(result.name).toBe('Generic Item');
            expect(result.price).toBe(50);
        });

        it('should throw error if required fields missing', () => {
            const raw = { invalid: 'data' };
            expect(() => service.normalizeVendorListing(raw, 'unknown_source')).toThrow();
        });
    });
});
