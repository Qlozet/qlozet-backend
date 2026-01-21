import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingsService } from './embeddings.service';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

describe('EmbeddingsService', () => {
    let service: EmbeddingsService;
    let catalogService: CatalogService;

    const mockCatalogItems = [
        {
            itemId: 'item-1',
            name: 'Blue Shirt',
            description: 'A nice blue shirt',
            type: CatalogItemType.GARMENT,
            tags: ['casual'],
            fitMeta: { fitType: 'slim', targetDemographic: 'mens' },
            fabricComposition: '100% Cotton',
            save: jest.fn(),
            id: 'item-1-id'
        },
        {
            itemId: 'item-2',
            name: 'Silk Fabric',
            description: 'Smooth silk',
            type: CatalogItemType.FABRIC,
            fabricComposition: '100% Silk',
            save: jest.fn(),
            id: 'item-2-id'
        }
    ];

    const mockCatalogService = {
        findAll: jest.fn().mockResolvedValue(mockCatalogItems),
        update: jest.fn().mockResolvedValue({}),
    };

    const mockConfigService = {
        get: jest.fn().mockReturnValue('dummy-key'),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmbeddingsService,
                { provide: ConfigService, useValue: mockConfigService },
                { provide: CatalogService, useValue: mockCatalogService },
            ],
        }).compile();

        service = module.get<EmbeddingsService>(EmbeddingsService);
        catalogService = module.get<CatalogService>(CatalogService);

        // Spy on generateEmbedding to avoid actual API calls during logic tests
        jest.spyOn(service, 'generateEmbedding').mockResolvedValue([0.1, 0.2, 0.3]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('buildCanonicalItemText', () => {
        it('should build text for garment', () => {
            const item: any = mockCatalogItems[0];
            const text = service.buildCanonicalItemText(item);
            expect(text).toContain('Blue Shirt');
            expect(text).toContain('slim for mens');
            expect(text).toContain('100% Cotton');
        });

        it('should build text for fabric', () => {
            const item: any = mockCatalogItems[1];
            const text = service.buildCanonicalItemText(item);
            expect(text).toContain('Silk Fabric');
            expect(text).toContain('100% Silk');
        });
    });

    describe('backfillItemEmbeddings', () => {
        it('should iterate and update items', async () => {
            const result = await service.backfillItemEmbeddings();
            expect(result.processed).toBe(2);
            expect(catalogService.findAll).toHaveBeenCalled();
            expect(service.generateEmbedding).toHaveBeenCalledTimes(2);
            expect(catalogService.update).toHaveBeenCalledTimes(2);
            expect(catalogService.update).toHaveBeenCalledWith('item-1-id', expect.objectContaining({
                embeddings: expect.objectContaining({ e_style: [0.1, 0.2, 0.3] })
            }));
        });

        it('should skip already embedded items', async () => {
            const itemsWithEmb = [
                { ...mockCatalogItems[0], embeddings: { e_style: [1] } },
                mockCatalogItems[1]
            ];
            (catalogService.findAll as jest.Mock).mockResolvedValueOnce(itemsWithEmb);

            const result = await service.backfillItemEmbeddings();
            expect(result.processed).toBe(1); // Only item-2
            expect(catalogService.update).toHaveBeenCalledTimes(1);
        });
    });
});
