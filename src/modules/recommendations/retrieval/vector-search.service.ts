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
                    name: 1,
                    description: 1,
                    type: 1,
                    price: 1,
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
}
