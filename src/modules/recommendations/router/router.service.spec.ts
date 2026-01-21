import { Test, TestingModule } from '@nestjs/testing';
import { RouterService } from './router.service';
import { ConfigService } from '@nestjs/config';
import { RecommendationIntent } from './enums/recommendation-intent.enum';

describe('RouterService', () => {
    let service: RouterService;

    // Mock OpenAI
    const mockOpenAI = {
        apiKey: 'test-key',
        chat: {
            completions: {
                create: jest.fn(),
            },
        },
    };

    const mockConfigService = {
        get: jest.fn().mockReturnValue('test-key'),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RouterService,
                { provide: ConfigService, useValue: mockConfigService },
            ],
        }).compile();

        service = module.get<RouterService>(RouterService);
        // Inject mock OpenAI directly
        (service as any).openai = mockOpenAI;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should parse valid JSON response', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'occasion',
                        confidence: 0.95,
                        constraints: { occasion: 'wedding' }
                    })
                }
            }]
        });

        const result = await service.classifyIntent('What to wear to a wedding');
        expect(result.intent).toBe(RecommendationIntent.OCCASION);
        expect(result.constraints!.occasion).toBe('wedding');
        expect(result.confidence).toBe(0.95);
    });

    it('should fallback on low confidence', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'occasion',
                        confidence: 0.4,
                        constraints: {}
                    })
                }
            }]
        });

        const result = await service.classifyIntent('IDK something maybe');
        expect(result.intent).toBe(RecommendationIntent.HOME_FEED);
        expect(result.confidence).toBe(0.4);
    });

    it('should fallback on error', async () => {
        mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));
        const result = await service.classifyIntent('hello');
        expect(result.intent).toBe(RecommendationIntent.HOME_FEED);
        expect(result.confidence).toBe(0.0);
    });
});
