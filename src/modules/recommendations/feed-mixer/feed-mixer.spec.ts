import { Test, TestingModule } from '@nestjs/testing';
import { FeedMixerService } from './feed-mixer.service';
import { RankedItem } from '../rankers/rankers.service';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

describe('FeedMixerService', () => {
    let service: FeedMixerService;

    const mockItem = (id: string, type: CatalogItemType, vendor: string): RankedItem => ({
        itemId: id,
        type,
        vendor,
        score: 1,
        name: 'Test Item',
        price: 100,
        currency: 'NGN',
        tags: [],
    } as any);

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [FeedMixerService],
        }).compile();

        service = module.get<FeedMixerService>(FeedMixerService);
    });

    it('should interleave items according to pattern', () => {
        const garments = Array.from({ length: 10 }, (_, i) => mockItem(`g${i}`, CatalogItemType.GARMENT, `v${i}`));
        const accessories = Array.from({ length: 5 }, (_, i) => mockItem(`a${i}`, CatalogItemType.ACCESSORY, `v${i}`));
        const fabrics = Array.from({ length: 5 }, (_, i) => mockItem(`f${i}`, CatalogItemType.FABRIC, `v${i}`));

        // Pattern: C C A C C F
        const mixed = service.mixCandidates(garments, accessories, fabrics, 10);

        expect(mixed[0].type).toBe(CatalogItemType.GARMENT);
        expect(mixed[1].type).toBe(CatalogItemType.GARMENT);
        expect(mixed[2].type).toBe(CatalogItemType.ACCESSORY);
        expect(mixed[3].type).toBe(CatalogItemType.GARMENT);
        expect(mixed[4].type).toBe(CatalogItemType.GARMENT);
        expect(mixed[5].type).toBe(CatalogItemType.FABRIC);
    });

    it('should cap top 10 items per vendor', () => {
        // Create many items from same vendor
        const garments = Array.from({ length: 10 }, (_, i) => mockItem(`g${i}`, CatalogItemType.GARMENT, 'vendor_spam'));
        const accessories = Array.from({ length: 5 }, (_, i) => mockItem(`a${i}`, CatalogItemType.ACCESSORY, 'vendor_other'));
        const fabrics = Array.from({ length: 5 }, (_, i) => mockItem(`f${i}`, CatalogItemType.FABRIC, 'vendor_other'));

        const mixed = service.mixCandidates(garments, accessories, fabrics, 10);

        // In top 10, vendor_spam should appear max 2 times
        const spamCount = mixed.filter(i => i.vendor === 'vendor_spam').length;
        expect(spamCount).toBeLessThanOrEqual(2);
    });

    it('should fallback if a stream is empty', () => {
        const garments = Array.from({ length: 5 }, (_, i) => mockItem(`g${i}`, CatalogItemType.GARMENT, `v${i}`));
        // No accessories or fabrics

        const mixed = service.mixCandidates(garments, [], [], 10);

        expect(mixed.length).toBe(5);
        expect(mixed.every(i => i.type === CatalogItemType.GARMENT)).toBe(true);
    });
});
