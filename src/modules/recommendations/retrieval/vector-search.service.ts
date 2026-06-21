import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogItem, CatalogItemDocument } from '../catalog/schemas/catalog-item.schema';

@Injectable()
export class VectorSearchService {
    private readonly logger = new Logger(VectorSearchService.name);

    constructor(@InjectModel(CatalogItem.name) private catalogModel: Model<CatalogItemDocument>) { }

    async search(
        embedding: number[],
        indexName: string,
        limit: number = 10,
        numCandidates: number = 100,
        filter?: Record<string, any>,
    ): Promise<any[]> {
        const pipeline: any[] = [
            {
                $vectorSearch: {
                    index: indexName,
                    path: indexName === 'items_fabric_vindex' ? 'embeddings.e_fabric' : 'embeddings.e_style',
                    queryVector: embedding,
                    numCandidates: numCandidates,
                    limit: limit,
                    filter: filter || undefined,
                },
            },
            {
                $project: {
                    itemId: 1,
                    name: 1,
                    description: 1,
                    type: 1,
                    price: 1,
                    currency: 1,
                    vendor: 1,
                    tags: 1,
                    fitMeta: 1,
                    fabricComposition: 1,
                    material: 1,
                    score: { $meta: 'vectorSearchScore' },
                },
            },
        ];

        try {
            return await this.catalogModel.aggregate(pipeline).exec();
        } catch (error) {
            this.logger.error(`Vector search failed for index ${indexName}: ${(error as Error).message}`);
            throw error;
        }
    }

    /**
     * Test if a vector search index exists and is responsive.
     * Uses a dummy vector to probe the index.
     */
    async testIndex(indexName: string, dimensions: number = 1536): Promise<{
        exists: boolean;
        sampleCount: number;
        sampleResult: any | null;
        error: string | null;
    }> {
        const dummyVector = new Array(dimensions).fill(0.01);
        try {
            const results = await this.search(dummyVector, indexName, 3, 10);
            return {
                exists: true,
                sampleCount: results.length,
                sampleResult: results[0] ? { name: results[0].name, score: results[0].score } : null,
                error: null,
            };
        } catch (error) {
            return {
                exists: false,
                sampleCount: 0,
                sampleResult: null,
                error: (error as Error).message,
            };
        }
    }
}

