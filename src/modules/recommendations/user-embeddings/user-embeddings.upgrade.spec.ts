import { Test, TestingModule } from '@nestjs/testing';
import { UserEmbeddingsService } from './user-embeddings.service';
import { EventsService } from '../events/events.service';
import { UserService } from '../../ums/services/users.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { getModelToken } from '@nestjs/mongoose';
import { UserEmbedding } from './schemas/user-embedding.schema';

describe('UserEmbeddingsService (Upgrade)', () => {
    let service: UserEmbeddingsService;

    const mockUserEmbeddingModel = {
        findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };

    const mockEventsService = {
        getRecentEvents: jest.fn().mockResolvedValue([]),
    };

    const mockUserService = {
        findOne: jest.fn(),
    };

    const mockEmbeddingsService = {
        generateEmbedding: jest.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserEmbeddingsService,
                { provide: getModelToken(UserEmbedding.name), useValue: mockUserEmbeddingModel },
                { provide: EventsService, useValue: mockEventsService },
                { provide: UserService, useValue: mockUserService },
                { provide: EmbeddingsService, useValue: mockEmbeddingsService },
            ],
        }).compile();

        service = module.get<UserEmbeddingsService>(UserEmbeddingsService);
    });

    describe('computeUserStyleVector', () => {
        it('should blend explicit preferences if user exists', async () => {
            mockUserService.findOne.mockResolvedValue({
                _id: 'u1',
                wears_preference: 'Male',
                aesthetic_preferences: ['Minimalist'],
                body_fit: ['Slim'],
                measurementSets: [{ active: true, measurements: { chest: 100 } }]
            });

            const vec = await service.computeUserStyleVector('u1');

            expect(mockUserService.findOne).toHaveBeenCalledWith('u1');
            expect(mockEmbeddingsService.generateEmbedding).toHaveBeenCalled();
            expect(mockUserEmbeddingModel.findOneAndUpdate).toHaveBeenCalledWith(
                { userId: 'u1' },
                expect.objectContaining({
                    u_fit: expect.any(Array),
                    scalars: { fit_preference: 'Slim' }
                }),
                expect.any(Object)
            );
        });

        it('should handle measurement vector generation', () => {
            const measurements = { chest: 100, waist: 80 };
            const vec = (service as any).computeMeasurementVector(measurements);
            expect(vec).toHaveLength(16);
            expect(vec[0]).toBeGreaterThan(0); // Normalized chest
        });

        it('should handle missing user elegantly', async () => {
            mockUserService.findOne.mockResolvedValue(null);
            const vec = await service.computeUserStyleVector('u_unknown');
            expect(vec).toBeNull(); // No events and no user
        });
    });
});
