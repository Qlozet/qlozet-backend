import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RecommendationIntent } from './enums/recommendation-intent.enum';
import { RouterResponseDto } from './dto/router-response.dto';
// Temporarily commenting out all service dependencies to isolate the issue
// import { RetrievalService } from '../retrieval/retrieval.service';
// import { FiltersService } from '../filters/filters.service';
// import { RankersService } from '../rankers/rankers.service';
// import { ExplanationsService } from '../explanations/explanations.service';
// import { EventsService } from '../events/events.service';

@Injectable()
export class RouterService {
    private openai: OpenAI;
    private readonly logger = new Logger(RouterService.name);
    private readonly CONFIDENCE_THRESHOLD = 0.7;

    constructor(
        private configService: ConfigService,
        // private retrievalService: RetrievalService,
        // private filtersService: FiltersService,
        // private rankersService: RankersService,
        // private explanationsService: ExplanationsService,
        // private eventsService: EventsService,
    ) {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        this.openai = new OpenAI({ apiKey: apiKey || 'dummy' });
    }

    async classifyIntent(text: string): Promise<RouterResponseDto> {
        if (!text || !text.trim()) {
            return { intent: RecommendationIntent.HOME_FEED, confidence: 1.0, constraints: {} };
        }

        if (this.openai.apiKey === 'dummy') {
            this.logger.warn('Skipping classification (no API key)');
            return { intent: RecommendationIntent.HOME_FEED, confidence: 0.1, constraints: {} };
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are a recommendation router. Classify user query into intents:
            - home_feed: General browsing
            - similar: Like "find more like this"
            - fit_help: Sizing questions
            - occasion: "What to wear for wedding"
            - fabric_help: About materials
            - bespoke: Custom tailoring requests
            - substitution: "Alternative to X"
            
            Return JSON only: { "intent": string, "constraints": object, "confidence": number }.
            Extract constraints like "gender", "color", "occasion", "budget".
            Do not extract constraints not present in text.
            `
                    },
                    { role: 'user', content: text }
                ],
                response_format: { type: 'json_object' },
                temperature: 0,
            });

            const content = response.choices[0].message.content;
            if (content === null) {
                this.logger.warn('Empty response from OpenAI');
                return { intent: RecommendationIntent.HOME_FEED, confidence: 0.1, constraints: {} };
            }
            const result = JSON.parse(content);

            let intent = result.intent;
            const validIntents = Object.values(RecommendationIntent);
            if (!validIntents.includes(intent)) {
                this.logger.warn(`Invalid intent classified: ${intent}, defaulting to home_feed`);
                intent = RecommendationIntent.HOME_FEED;
            }

            const confidence = typeof result.confidence === 'number' ? result.confidence : 0.5;
            if (confidence < this.CONFIDENCE_THRESHOLD) {
                this.logger.log(`Low confidence (${confidence}) for query "${text}", defaulting to home_feed`);
                return {
                    intent: RecommendationIntent.HOME_FEED,
                    confidence: confidence,
                    constraints: result.constraints || {}
                };
            }

            return {
                intent: intent as RecommendationIntent,
                confidence: confidence,
                constraints: result.constraints || {}
            };

        } catch (error) {
            this.logger.error('Error classifying intent', error);
            return { intent: RecommendationIntent.HOME_FEED, confidence: 0.0, constraints: {} };
        }
    }

    /**
     * Main recommendation method called by the controller
     * @param userId - The user ID requesting recommendations
     * @param context - Additional context (query, filters, etc.)
     * @returns Recommendation results
     */
    async recommend(userId: string, context: any) {
        this.logger.log(`Generating recommendations for user ${userId}`);

        // Extract query from context if present
        const query = context.query || context.text || '';

        // Classify the intent
        const classification = await this.classifyIntent(query);

        // TODO: Once services are uncommented, implement full pipeline:
        // 1. Retrieve candidates using retrievalService
        // 2. Apply filters using filtersService
        // 3. Rank results using rankersService
        // 4. Generate explanations using explanationsService
        // 5. Log event using eventsService

        // For now, return the classification result
        return {
            userId,
            intent: classification.intent,
            confidence: classification.confidence,
            constraints: classification.constraints,
            items: [], // Will be populated when services are uncommented
            message: 'Recommendation pipeline is currently in development. Intent classification is working.'
        };
    }
}
