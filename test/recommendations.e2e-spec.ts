import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { RecommendationsModule } from '../src/modules/recommendations/recommendations.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

// Mock dependencies to avoid actual DB/OpenAI calls in this quick E2E check
import { RetrievalService } from '../src/modules/recommendations/retrieval/retrieval.service';
import { UserEmbeddingsService } from '../src/modules/recommendations/user-embeddings/user-embeddings.service';
import { EventsService } from '../src/modules/recommendations/events/events.service';

describe('RecommendationsController (e2e)', () => {
    let app: INestApplication;

    const mockRetrievalService = {
        retrieveCandidatesForHomeFeed: jest.fn().mockResolvedValue([
            { itemId: 'item1', price: 50, tags: ['test'], type: 'garment' },
            { itemId: 'item2', price: 150, tags: ['other'], type: 'garment' }
        ])
    };

    const mockUserEmbeddingsService = {
        computeUserStyleVector: jest.fn().mockResolvedValue([0.1, 0.2]),
        computeSessionStyleVector: jest.fn().mockResolvedValue(null),
        blendVectors: jest.fn().mockReturnValue([0.1, 0.2]),
    };

    const mockEventsService = {
        getRecentEvents: jest.fn().mockResolvedValue([])
    };

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                // We don't import the full module because we want to override providers
                // But constructing the full dependency tree for E2E is complex without a real DB.
                // We will test just the Controller+Service layer by mocking lower layers.
                RecommendationsModule,
            ],
        })
            .overrideProvider(RetrievalService).useValue(mockRetrievalService)
            .overrideProvider(UserEmbeddingsService).useValue(mockUserEmbeddingsService)
            .overrideProvider(EventsService).useValue(mockEventsService)
            // We need to validly mock Mongoose if the module imports it. 
            // Since RecommendationsModule imports sub-modules that import Mongoose, 
            // it's cleaner to mock the services that use Mongoose.
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('/recommend/feed (GET)', () => {
        return request(app.getHttpServer())
            .get('/recommend/feed?userId=user1&limit=10&budgetMax=100')
            .expect(200)
            .expect((res) => {
                expect(res.body.items).toBeDefined();
                // Mock returns 2 items. Budget max 100 should filter item2 (price 150).
                expect(res.body.items.length).toBe(1);
                expect(res.body.items[0].itemId).toBe('item1');
                expect(res.body.debug).toBeDefined();
                expect(res.body.debug.coldStartLevel).toBe('hot'); // user vector present
            });
    });
});
