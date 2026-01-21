import { Test, TestingModule } from '@nestjs/testing';
import { RankersService } from './rankers.service';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';

describe('RankersService', () => {
    let service: RankersService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [RankersService],
        }).compile();

        service = module.get<RankersService>(RankersService);
    });

    describe('rankCandidates', () => {
        const items: CatalogItem[] = [
            { itemId: '1', price: 100, score: 0.9, rawVendorData: { vendorQuality: 1.0, eta_days: 1 } } as any,
            { itemId: '2', price: 200, score: 0.8, rawVendorData: { vendorQuality: 0.5, eta_days: 7 } } as any,
        ];

        it('should calculate correct scores', () => {
            const result = service.rankCandidates(items, { budgetMax: 150 });

            const item1 = result.find(r => r.itemId === '1');
            if (!item1) throw new Error('Item 1 not found');
            // Item 1:
            // vScore=0.9, vQ=1.0, eta=1/(1+1)=0.5, priceFit=1 (100<=150)
            // Score = 0.7*0.9 + 0.15*1.0 + 0.10*0.5 + 0.05*1
            //       = 0.63    + 0.15     + 0.05     + 0.05
            //       = 0.88
            expect(item1.finalScore).toBeCloseTo(0.88);
        });

        it('should rank higher scores first', () => {
            const result = service.rankCandidates(items, { budgetMax: 150 });
            expect(result[0].itemId).toBe('1');
            expect(result[1].itemId).toBe('2');
        });

        it('should penalize price overflow', () => {
            const overBudget = { itemId: '3', price: 200, score: 0.9, rawVendorData: { vendorQuality: 1.0, eta_days: 1 } } as any; // Same as item1 but expensive
            const result = service.rankCandidates([overBudget], { budgetMax: 100 });
            // PriceFit = 100/200 = 0.5
            // Score = 0.63 + 0.15 + 0.05 + 0.05*0.5 = 0.88 - 0.025 = 0.855
            expect(result[0].finalScore).toBeCloseTo(0.855);
        });
    });
});
