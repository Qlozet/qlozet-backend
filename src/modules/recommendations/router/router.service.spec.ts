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

    it('shows the classifier the previous question and reports whether this one continues it', async () => {
        mockOpenAI.chat.completions.create.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        intent: 'occasion',
                        confidence: 0.9,
                        constraints: { occasion: 'wedding', color: ['blue'] },
                        continues_previous: true,
                    })
                }
            }]
        });

        const result = await service.classifyIntent('the same in blue', 'agbada for a wedding');
        expect(result.continuesPrevious).toBe(true);
        expect(result.constraints!.occasion).toBe('wedding');

        const sent = mockOpenAI.chat.completions.create.mock.calls[0][0].messages;
        const userMessage = sent[sent.length - 1].content as string;
        expect(userMessage).toContain('Previous question: "agbada for a wedding"');
        expect(userMessage).toContain('Current question: "the same in blue"');

        // Without a previous question the text goes as-is and the flag is false.
        mockOpenAI.chat.completions.create.mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ intent: 'occasion', confidence: 0.9, constraints: {} }) } }]
        });
        const fresh = await service.classifyIntent('kaftan');
        expect(fresh.continuesPrevious).toBe(false);
        const freshSent = mockOpenAI.chat.completions.create.mock.calls[1][0].messages;
        expect(freshSent[freshSent.length - 1].content).toBe('kaftan');
    });
});
