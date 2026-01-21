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

    async backfillItemEmbeddings(options: { kind?: string; limit?: number } = {}) {
        this.logger.log('Starting embedding backfill...');
        const items = await this.catalogService.findAll();
        let count = 0;

        for (const item of items) {
            if (options.limit && count >= options.limit) break;
            // Skip if already embedded (check e_style existence)
            if (item.embeddings?.e_style) continue;

            if (options.kind && item.type !== options.kind) continue;

            const canonicalText = this.buildCanonicalItemText(item);
            const vector = await this.generateEmbedding(canonicalText);

            const updateData: Partial<CatalogItem> = {
                embeddings: {
                    ...item.embeddings,
                    e_style: vector,
                    // e_fabric optional logic could go here
                },
                embeddingMetadata: {
                    model: this.embeddingModel,
                    dim: this.embeddingDim,
                    version: this.embeddingVersion,
                    embedded_at: new Date(),
                }
            };

            await this.catalogService.update(item.id, updateData);
            count++;
            this.logger.debug(`Embedded item ${item.itemId}`);
        }
        this.logger.log(`Backfill complete. Processed ${count} items.`);
        return { processed: count };
    }
}
