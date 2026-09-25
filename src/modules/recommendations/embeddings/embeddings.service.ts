import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogItem } from '../catalog/schemas/catalog-item.schema';
import { CatalogItemType } from '../catalog/enums/catalog-item-type.enum';

@Injectable()
export class EmbeddingsService {
    private openai: OpenAI;
    private readonly logger = new Logger(EmbeddingsService.name);
    private readonly embeddingModel = 'text-embedding-3-small';
    private readonly embeddingDim = 1536;
    private readonly embeddingVersion = 'v1';

    constructor(
        private configService: ConfigService,
        private catalogService: CatalogService,
    ) {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        if (!apiKey) {
            this.logger.warn('OPENAI_API_KEY is not set');
        }
        this.openai = new OpenAI({ apiKey: apiKey || 'dummy' });
    }

    async generateEmbedding(text: string): Promise<number[]> {
        try {
            if (!this.openai.apiKey || this.openai.apiKey === 'dummy') {
                this.logger.warn('Skipping embedding generation (no API key)');
                return new Array(1536).fill(0);
            }
            const response = await this.openai.embeddings.create({
                model: this.embeddingModel,
                input: text,
            });
            return response.data[0].embedding;
        } catch (error) {
            this.logger.error('Error generating embedding', error);
            throw error;
        }
    }

    buildCanonicalItemText(item: CatalogItem): string {
        const parts = [item.name, item.description];

        // Add generic tags
        if (item.tags && item.tags.length > 0) {
            parts.push(`Tags: ${item.tags.join(', ')}`);
        }

        if (item.type === CatalogItemType.GARMENT) {
            if (item.fitMeta) {
                parts.push(`Fit: ${item.fitMeta.fitType} for ${item.fitMeta.targetDemographic}`);
            }
            if (item.fabricComposition) {
                parts.push(`Composition: ${item.fabricComposition}`);
            }
        } else if (item.type === CatalogItemType.FABRIC) {
            if (item.fabricComposition) {
                parts.push(`Fabric: ${item.fabricComposition}`);
            }
        } else if (item.type === CatalogItemType.ACCESSORY) {
            if (item.material) {
                parts.push(`Material: ${item.material}`);
            }
        }

        return parts.filter(p => !!p).join('. ');
    }

    /**
     * Embed a single catalog item. Used by CatalogSyncListener after product sync.
     * Skips if item already has an embedding.
     */
    /** Fingerprint of the text a vector was built from. */
    private hashCanonicalText(text: string): string {
        return createHash('sha256').update(text).digest('hex');
    }

    async embedSingleItem(itemId: string): Promise<boolean> {
        const item = await this.catalogService.findById(itemId);
        if (!item) {
            this.logger.warn(`embedSingleItem: item ${itemId} not found`);
            return false;
        }

        const canonicalText = this.buildCanonicalItemText(item);
        const textHash = this.hashCanonicalText(canonicalText);

        // Skip only when the vector was built from THIS text. Previously any
        // existing vector meant skip, so an edited description never reached
        // the recommender — the item kept scoring against its original copy
        // forever. Items predating text_hash re-embed once, then settle.
        if (
            item.embeddings?.e_style?.length &&
            item.embeddingMetadata?.text_hash === textHash &&
            item.embeddingMetadata?.version === this.embeddingVersion
        ) {
            this.logger.debug(`Item ${itemId} embedding is current, skipping`);
            return false;
        }

        const vector = await this.generateEmbedding(canonicalText);

        await this.catalogService.update(itemId, {
            embeddings: {
                ...item.embeddings,
                e_style: vector,
            },
            embeddingMetadata: {
                model: this.embeddingModel,
                dim: this.embeddingDim,
                version: this.embeddingVersion,
                text_hash: textHash,
                embedded_at: new Date(),
            },
        });

        this.logger.debug(`Embedded item ${itemId}`);
        return true;
    }

    /**
     * Backfill embeddings for all catalog items that don't have one yet.
     * Uses targeted query instead of findAll() to avoid loading entire catalog.
     * Includes rate limiting (50ms between calls) for OpenAI API.
     */
    async backfillItemEmbeddings(
        options: { kind?: string; limit?: number; includeStale?: boolean } = {},
    ) {
        this.logger.log('Starting embedding backfill...');

        // Items with no vector at all. `includeStale` widens this to rows
        // embedded before text_hash existed, so a one-off run can refresh
        // everything written while edits were being ignored.
        const filter: Record<string, any> = {
            $or: [
                { 'embeddings.e_style': { $exists: false } },
                { 'embeddings.e_style': { $size: 0 } },
                { 'embeddings.e_style': null },
                ...(options.includeStale
                    ? [{ 'embeddingMetadata.text_hash': { $exists: false } }]
                    : []),
            ],
        };
        if (options.kind) filter.type = options.kind;

        const items = await this.catalogService.findByFilter(filter, options.limit || 0);
        let count = 0;
        let errors = 0;

        for (const item of items) {
            try {
                const canonicalText = this.buildCanonicalItemText(item);
                const vector = await this.generateEmbedding(canonicalText);

                await this.catalogService.update(item.itemId, {
                    embeddings: {
                        ...item.embeddings,
                        e_style: vector,
                    },
                    embeddingMetadata: {
                        model: this.embeddingModel,
                        dim: this.embeddingDim,
                        version: this.embeddingVersion,
                        text_hash: this.hashCanonicalText(canonicalText),
                        embedded_at: new Date(),
                    },
                });

                count++;
                this.logger.debug(`Embedded item ${item.itemId} (${count}/${items.length})`);

                // Rate limit: 50ms between OpenAI calls
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                errors++;
                this.logger.error(`Failed to embed item ${item.itemId}: ${e.message}`);
            }
        }

        this.logger.log(`Backfill complete. Processed ${count}, errors ${errors}.`);
        return { processed: count, errors, total: items.length };
    }
}

