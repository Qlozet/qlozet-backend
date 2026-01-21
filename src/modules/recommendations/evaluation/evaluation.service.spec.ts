import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationService } from './evaluation.service';
import { EventType } from '../events/enums/event-type.enum';

describe('EvaluationService', () => {
    let service: EvaluationService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [EvaluationService],
        }).compile();

        service = module.get<EvaluationService>(EvaluationService);
    });

    it('should compute metrics correctly', () => {
        const recs = [
            { itemId: '1', vendor: 'V1', type: 'T1' },
            { itemId: '2', vendor: 'V1', type: 'T2' },
            { itemId: '3', vendor: 'V2', type: 'T1' },
        ] as any[];

        const events = [
            { eventType: EventType.CLICK_ITEM, properties: { itemId: '1' } },
            { eventType: EventType.CLICK_ITEM, properties: { itemId: '99' } }, // Miss
            { eventType: EventType.ADD_TO_CART, properties: { itemId: '3' } },
        ] as any[];

        const metrics = service.computeMetrics(recs, events, 3);

        // Click Matches: Item 1. Total Clicks: 2. CTR proxy ratio: 1/2 = 0.5 (or could be precision 1/3, defined as recall in implementation currently)
        // Implementation uses: matches / total_events_of_type. This is Recall@K given the event set.
        expect(metrics.ctrAtK).toBe(0.5);

        // Conversion Matches: Item 3. Total Conv: 1. Ratio: 1/1 = 1.0
        expect(metrics.conversionAtK).toBe(1.0);

        // Diversity
        expect(metrics.diversity.uniqueVendors).toBe(2); // V1, V2
        expect(metrics.diversity.uniqueCategories).toBe(2); // T1, T2
    });
});
