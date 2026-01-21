import { Test, TestingModule } from '@nestjs/testing';
import { IntegrityService } from './integrity.service';
import { getModelToken } from '@nestjs/mongoose';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { BusinessService } from '../../business/business.service';
import { UserEmbeddingsService } from '../user-embeddings/user-embeddings.service';

describe('IntegrityService', () => {
    let service: IntegrityService;

    const mockCatalogModel = {
        countDocuments: jest.fn(),
        distinct: jest.fn().mockReturnThis(),
        exec: jest.fn(),
    };

    const mockBusinessService = {
        findOne: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                IntegrityService,
                { provide: getModelToken(CatalogItem.name), useValue: mockCatalogModel },
                { provide: EmbeddingsService, useValue: {} },
                { provide: BusinessService, useValue: mockBusinessService },
                { provide: UserEmbeddingsService, useValue: {} },
            ],
        }).compile();

        service = module.get<IntegrityService>(IntegrityService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should report warning if embeddings are missing', async () => {
        mockCatalogModel.countDocuments.mockResolvedValue(5);
        const result = await service.checkEmbeddingsIntegrity();
        expect(result.count).toBe(5);
        expect(result.status).toBe('WARNING');
    });

    it('should report OK if no embeddings are missing', async () => {
        mockCatalogModel.countDocuments.mockResolvedValue(0);
        const result = await service.checkEmbeddingsIntegrity();
        expect(result.count).toBe(0);
        expect(result.status).toBe('OK');
    });

    it('should count invalid vendors', async () => {
        mockCatalogModel.exec.mockResolvedValue(['v1', 'v2']); // distinct vendors
        mockBusinessService.findOne.mockResolvedValueOnce({ is_active: true, status: 'approved' }); // v1 ok
        mockBusinessService.findOne.mockResolvedValueOnce(null); // v2 missing

        const result = await service.checkVendorIntegrity();
        expect(result.invalidVendors).toBe(1);
        expect(result.checked).toBe(2);
    });
});
