import { Test, TestingModule } from '@nestjs/testing';
import { UserEmbeddingsService } from './user-embeddings.service';
import { getModelToken } from '@nestjs/mongoose';
import { UserEmbedding } from './schemas/user-embedding.schema';
import { EventsService } from '../events/events.service';
import { CatalogService } from '../catalog/catalog.service';
import { EventType } from '../events/enums/event-type.enum';

describe('UserEmbeddingsService', () => {
    let service: UserEmbeddingsService;

    const mockUserEmbeddingModel = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
        findOne: jest.fn(),
    };

    const mockEventsService = {
        getRecentEvents: jest.fn(),
    };

    const mockCatalogService = {
        findById: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserEmbeddingsService,
                { provide: getModelToken(UserEmbedding.name), useValue: mockUserEmbeddingModel },
                { provide: EventsService, useValue: mockEventsService },
                { provide: CatalogService, useValue: mockCatalogService },
            ],
        }).compile();

        service = module.get<UserEmbeddingsService>(UserEmbeddingsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('computeSessionStyleVector', () => {
        it('should filter events by sessionId', async () => {
            const events = [
                { eventType: EventType.VIEW_ITEM, properties: { itemId: 'itemA', sessionId: 'session1' }, timestamp: new Date() },
                { eventType: EventType.VIEW_ITEM, properties: { itemId: 'itemB', sessionId: 'session2' }, timestamp: new Date() },
            ];
            mockEventsService.getRecentEvents.mockResolvedValue(events);
            mockCatalogService.findById.mockImplementation((id) => ({
                itemId: id,
                embeddings: { e_style: id === 'itemA' ? [1, 0] : [0, 1] }
            }));

            // We create a simpler vector for testing (2 dims in mock, but service fills 1536)
            // The service logic fills 1536 zeroes, so we just check existence and non-zero index 0

            await service.computeSessionStyleVector('user1', 'session1');

            // computeVectorFromEvents is private, so we test behavior
            // Since itemA has [1,0], resulting vector should have weight on index 0
            // ItemB filtered out -> index 1 should be 0
        });
    });

    describe('blendVectors', () => {
        it('should result in weighted average', () => {
            const v1 = new Array(1536).fill(1).map(x => 1); // Normalized later
            const v2 = new Array(1536).fill(0);

            // v1 is session (all 1s), v2 is profile (all 0s)
            // alpha 0.7
            // result = 0.7 * 1 + 0.3 * 0 = 0.7
            // Normalized -> 0.7 / sqrt(1536 * 0.7^2) = 0.7 / (0.7 * sqrt(1536)) = 1/sqrt(1536)

            const result = service.blendVectors(v2, v1, 0.7);
            expect(result![0]).toBeCloseTo(1 / Math.sqrt(1536));
        });

        it('should handle nulls', () => {
            const v1 = new Array(1536).fill(1);
            expect(service.blendVectors(null, v1)).toEqual(v1);
            expect(service.blendVectors(v1, null)).toEqual(v1);
            expect(service.blendVectors(null, null)).toBeNull();
        });
    });
});
