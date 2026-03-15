import { Test, TestingModule } from '@nestjs/testing';
import { RetrievalService } from './retrieval.service';
import { VectorSearchService } from './vector-search.service';
import { CatalogService } from '../catalog/catalog.service';

describe('RetrievalService', () => {
    let service: RetrievalService;

    const mockVectorSearchService = {
        search: jest.fn(),
    };

    const mockCatalogService = {
        findAll: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RetrievalService,
                { provide: VectorSearchService, useValue: mockVectorSearchService },
                { provide: CatalogService, useValue: mockCatalogService },
            ],
        }).compile();

        service = module.get<RetrievalService>(RetrievalService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should retrieve personalized candidates and dedupe trending', async () => {
        const vectorItem = { itemId: 'item1', name: 'Personalized' };
        const trendingItem1 = { itemId: 'item1', name: 'Personalized' }; // Duplicate
        const trendingItem2 = { itemId: 'item2', name: 'Trending' };

        mockVectorSearchService.search.mockResolvedValue([vectorItem]);
        mockCatalogService.findAll.mockResolvedValue([trendingItem1, trendingItem2]);

        const result = await service.retrieveCandidatesForHomeFeed({
            userStyleVector: [0.1],
            limit: 5
        });

        expect(result.length).toBe(2);
        expect(result[0].itemId).toBe('item1');
        expect(result[1].itemId).toBe('item2');
    });

    it('should fail over to trending if vector search fails', async () => {
        mockVectorSearchService.search.mockRejectedValue(new Error('Atlas down'));
        mockCatalogService.findAll.mockResolvedValue([{ itemId: 't1' }, { itemId: 't2' }]);

        const result = await service.retrieveCandidatesForHomeFeed({
            userStyleVector: [0.1],
            limit: 2
        });

        expect(result.length).toBe(2);
        expect(result[0].itemId).toBe('t1');
    });

    it('should use trending if no user vector', async () => {
        mockCatalogService.findAll.mockResolvedValue([{ itemId: 't1' }]);

        const result = await service.retrieveCandidatesForHomeFeed({
            userStyleVector: null
        });

        expect(mockVectorSearchService.search).not.toHaveBeenCalled();
        expect(result.length).toBe(1);
    });
});
