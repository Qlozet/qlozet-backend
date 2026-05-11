import { Test, TestingModule } from '@nestjs/testing';
import { ExplanationsService } from './explanations.service';
import { EventsService } from '../events/events.service';
import { RankedItem } from '../rankers/rankers.service';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

describe('ExplanationsService', () => {
    let service: ExplanationsService;

    const mockEventsService = {};

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ExplanationsService,
                { provide: EventsService, useValue: mockEventsService },
            ],
        }).compile();

        service = module.get<ExplanationsService>(ExplanationsService);
    });

    describe('generateExplanations', () => {
        it('should generate explanations based on attributes', () => {
            const item: RankedItem = {
                itemId: '1',
                name: 'Fast Shoe',
                price: 100,
                currency: 'USD',
                type: CatalogItemType.ACCESSORY,
                vendor: 'Nike',
                tags: ['running', 'shoes'],
                finalScore: 0.9,
                score: 0.9, // vScore proxy
                scoringDebug: { vScore: 0.9, priceFit: 1, vendorQuality: 0.95 },
                rawVendorData: { eta_days: 2, vendorQuality: 0.95 }
            } as any;

            const history = [
                { properties: { tags: ['running'] } },
                { properties: { tags: ['gym'] } }
            ] as any[];

            const explanations = service.generateExplanations(item, history);

            expect(explanations.texts).toContain('Matches your interest in running');
            expect(explanations.texts).toContain('Highly relevant to your style');
            expect(explanations.texts).toContain('Fast Delivery');
            expect(explanations.texts).toContain('Top Rated Vendor');
            expect(explanations.texts).toContain('Within your budget');
        });

        it('should return empty if no evidence', () => {
            const item: RankedItem = {
                itemId: '2',
                tags: ['formal'],
                scoringDebug: { vScore: 0.5 },
                rawVendorData: { eta_days: 10, vendorQuality: 0.5 }
            } as any;

            const history = [] as any[];

            const explanations = service.generateExplanations(item, history);
            expect(explanations.texts.length).toBe(0);
        });
    });
});
