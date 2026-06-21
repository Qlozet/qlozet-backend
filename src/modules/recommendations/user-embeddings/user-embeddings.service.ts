import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEmbedding, UserEmbeddingDocument } from './schemas/user-embedding.schema';
import { EventsService } from '../events/events.service';
import { EventType } from '../events/enums/event-type.enum';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { CatalogService } from '../catalog/catalog.service';
import { UserService } from '../../ums/services/users.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';

@Injectable()
export class UserEmbeddingsService {
    private readonly logger = new Logger(UserEmbeddingsService.name);
    private readonly DECAY_LAMBDA = 0.05; // Decay rate

    // Weights for event types
    private readonly EVENT_WEIGHTS = {
        [EventType.PURCHASE]: 5.0,
        [EventType.PREFERRED_AESTHETIC]: 4.0,
        [EventType.ADD_TO_CART]: 3.0,
        [EventType.SAVE_ITEM]: 2.0,
        [EventType.CLICK_ITEM]: 1.0,
        [EventType.VIEW_ITEM]: 0.5,
        [EventType.NOT_INTERESTED]: -6.0,
        [EventType.HIDE_BUSINESS]: -10.0,
    };

    constructor(
        @InjectModel(UserEmbedding.name) private userEmbeddingModel: Model<UserEmbeddingDocument>,
        private eventsService: EventsService,
        private userService: UserService,
        private embeddingsService: EmbeddingsService,
        private catalogService: CatalogService,
    ) { }

    async computeUserStyleVector(userId: string): Promise<number[] | null> {
        // 1. Fetch Event History
        const events = await this.eventsService.getRecentEvents(userId, 100); // Increased history

        // 2. Fetch User Profile for Explicit Preferences
        let explicitVector: number[] | null = null;
        let userFitVector: number[] | null = null;
        let fitScalar: string | undefined;

        try {
            const user = await this.userService.findById(userId); // Assuming findOne accepts ID string
            if (user) {
                // Generate Explicit Preference Vector
                const parts: string[] = [];
                if (user.wears_preference) parts.push(`Wears: ${user.wears_preference}`);
                if (user.aesthetic_preferences?.length) parts.push(`Aesthetics: ${user.aesthetic_preferences.join(', ')}`);
                if (user.body_fit?.length) parts.push(`Fit preference: ${user.body_fit.join(', ')}`);

                if (parts.length > 0) {
                    const text = parts.join('. ');
                    explicitVector = await this.embeddingsService.generateEmbedding(text);
                }

                // Generate Measurement Vector (u_fit)
                // Simplified logic: find active measurement set
                const activeSet = user.measurementSets?.find(s => s.active);
                if (activeSet && activeSet.measurements) {
                    userFitVector = this.computeMeasurementVector(activeSet.measurements as any);
                }
                if (user.body_fit?.length) fitScalar = user.body_fit[0];
            }
        } catch (e) {
            this.logger.warn(`Failed to fetch user profile for efficiency: ${e.message}`);
        }

        // 3. Compute Implicit (Behavioral) Vector from event history
        // Uses computeVectorFromEvents which fetches catalog items,
        // applies time-decayed weighted pooling on their e_style embeddings
        let implicitVector: number[] | null = null;
        try {
            implicitVector = await this.computeVectorFromEvents(events);
        } catch (e) {
            this.logger.warn(`Failed to compute implicit vector for user ${userId}: ${e.message}`);
        }

        // 4. Blend Explicit (stated preferences) + Implicit (behavior)
        // - Both available: 70% implicit (what they actually do) + 30% explicit (what they say)
        // - Only implicit: use implicit (warm user with no profile prefs)
        // - Only explicit: use explicit (new user who set preferences)
        // - Neither: null (cold start)
        let finalVector: number[] | null = null;
        if (implicitVector && explicitVector) {
            finalVector = this.blendVectors(implicitVector, explicitVector, 0.7);
            this.logger.debug(`Blended implicit + explicit vectors for user ${userId}`);
        } else if (implicitVector) {
            finalVector = implicitVector;
            this.logger.debug(`Using implicit-only vector for user ${userId}`);
        } else if (explicitVector) {
            finalVector = explicitVector;
            this.logger.debug(`Using explicit-only vector for user ${userId}`);
        }

        // Save
        if (finalVector || userFitVector) {
            await this.saveEmbedding(userId, {
                u_style: finalVector || [],
                u_fit: userFitVector || undefined,
                scalars: fitScalar ? { fit_preference: fitScalar } : undefined
            });
            return finalVector;
        }

        return null;
    }

    // Simplified measurement encoder (mock implementation for 16-dims)
    private computeMeasurementVector(measurements: Record<string, number>): number[] {
        // In reality: normalize chest, waist, hips, height, etc. to 0-1 range or z-score
        // Here: Just output a placeholder 16-dim vector seeded by values
        const vec = new Array(16).fill(0);
        const values = Object.values(measurements);
        for (let i = 0; i < 16; i++) {
            if (i < values.length) vec[i] = Math.min(Math.max(values[i] / 200, 0), 1); // Normalize approx
        }
        return vec;
    }

    async computeSessionStyleVector(userId: string, sessionId: string, lastN: number = 30): Promise<number[] | null> {
        // Fetch ample events to filter down
        const events = await this.eventsService.getRecentEvents(userId, 100);
        const sessionEvents = events.filter(e => e.properties?.sessionId === sessionId).slice(0, lastN);

        return this.computeVectorFromEvents(sessionEvents);
    }

    public blendVectors(profile: number[] | null, session: number[] | null, alpha: number = 0.7): number[] | null {
        if (!profile) return session;
        if (!session) return profile;

        const blended = new Array(1536).fill(0);
        for (let i = 0; i < 1536; i++) {
            blended[i] = alpha * (session[i] || 0) + (1 - alpha) * (profile[i] || 0);
        }

        // Normalize
        const magnitude = Math.sqrt(blended.reduce((acc, val) => acc + val * val, 0));
        if (magnitude === 0) return blended;

        return blended.map(val => val / magnitude);
    }

    private async computeVectorFromEvents(events: any[]): Promise<number[] | null> {
        if (!events || events.length === 0) {
            return null;
        }

        // Bulk fetch catalog items instead of N individual queries
        const itemIds = [...new Set(
            events
                .map(e => e.properties?.itemId || e.properties?.item_id)
                .filter(id => !!id)
        )];

        if (itemIds.length === 0) return null;

        const items = await this.catalogService.findByIds(itemIds);
        const itemMap = new Map(items.filter(item => !!item).map(item => [item.itemId, item]));

        let weightedSum = new Array(1536).fill(0);
        let totalWeight = 0;

        for (const event of events) {
            const itemId = event.properties?.itemId;
            const item = itemMap.get(itemId);

            // Skip if item not found or has no style embedding
            if (!item || !item.embeddings?.e_style) continue;

            const baseWeight = this.EVENT_WEIGHTS[event.eventType as EventType] || 0;
            if (baseWeight === 0) continue;

            // Time decay
            const daysDiff = (Date.now() - new Date(event.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            const timeWeight = Math.exp(-daysDiff * this.DECAY_LAMBDA);

            const finalWeight = baseWeight * timeWeight;

            // Accumulate
            const embedding = item.embeddings.e_style;
            for (let i = 0; i < 1536; i++) {
                weightedSum[i] += embedding[i] * finalWeight;
            }
            totalWeight += Math.abs(finalWeight);
        }

        if (totalWeight === 0) return null;

        // Normalize
        const magnitude = Math.sqrt(weightedSum.reduce((acc, val) => acc + val * val, 0));
        if (magnitude === 0) return new Array(1536).fill(0);

        return weightedSum.map(val => val / magnitude);
    }

    async updateUserEmbedding(userId: string): Promise<UserEmbedding | null> {
        const vector = await this.computeUserStyleVector(userId);

        if (!vector) {
            this.logger.debug(`No interaction history to compute embedding for user ${userId}`);
            return null;
        }

        return this.userEmbeddingModel.findOne({ userId }).exec();
    }

    private async saveEmbedding(userId: string, data: Partial<UserEmbedding>): Promise<UserEmbedding> {
        return this.userEmbeddingModel.findOneAndUpdate(
            { userId },
            {
                userId,
                ...data,
                version: 'v1',
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        ).exec();
    }

    async getUserEmbedding(userId: string): Promise<number[] | null> {
        const doc = await this.userEmbeddingModel.findOne({ userId }).exec();
        return doc ? doc.u_style : null;
    }

    /**
     * Returns a cached user style vector if fresh (< 1 hour old),
     * otherwise recomputes and caches it.
     * This avoids calling the OpenAI embedding API on every feed request.
     */
    async getOrComputeUserStyleVector(userId: string): Promise<number[] | null> {
        const STALENESS_MS = 60 * 60 * 1000; // 1 hour

        try {
            const cached = await this.userEmbeddingModel.findOne({ userId }).lean();
            if (cached && cached.u_style && cached.u_style.length > 0 && cached.lastUpdated) {
                const age = Date.now() - new Date(cached.lastUpdated).getTime();
                if (age < STALENESS_MS) {
                    this.logger.debug(`Using cached embedding for user ${userId} (age: ${Math.round(age / 1000)}s)`);
                    return cached.u_style;
                }
                this.logger.debug(`Cached embedding stale for user ${userId} (age: ${Math.round(age / 1000)}s), recomputing`);
            }
        } catch (e) {
            this.logger.warn(`Cache lookup failed for user ${userId}: ${e.message}`);
        }

        // Cache miss or stale — recompute (this calls saveEmbedding internally)
        return this.computeUserStyleVector(userId);
    }

    /**
     * Invalidates the cached embedding by back-dating lastUpdated,
     * so the next feed request triggers a fresh recompute.
     */
    async invalidateCache(userId: string): Promise<void> {
        try {
            await this.userEmbeddingModel.updateOne(
                { userId },
                { $set: { lastUpdated: new Date(0) } }, // epoch = always stale
            );
            this.logger.debug(`Invalidated embedding cache for user ${userId}`);
        } catch (e) {
            this.logger.warn(`Failed to invalidate cache for user ${userId}: ${e.message}`);
        }
    }
}
