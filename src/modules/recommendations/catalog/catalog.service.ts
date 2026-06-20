import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogItem, CatalogItemDocument } from './schemas/catalog-item.schema';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { CatalogItemType } from './enums/catalog-item-type.enum';

@Injectable()
export class CatalogService {
    private readonly logger = new Logger(CatalogService.name);

    constructor(@InjectModel(CatalogItem.name) private catalogModel: Model<CatalogItemDocument>) { }

    async create(createCatalogItemDto: CreateCatalogItemDto): Promise<CatalogItem> {
        const createdItem = new this.catalogModel(createCatalogItemDto);
        return createdItem.save();
    }

    async findAll(): Promise<CatalogItemDocument[]> {
        return this.catalogModel.find().exec();
    }

    async findById(itemId: string): Promise<CatalogItem | null> {
        return this.catalogModel.findOne({ itemId }).exec();
    }

    /**
     * Fetch items created after a given date, sorted newest-first.
     * Used by getNewArrivalsFeed() instead of findAll() + in-memory filter.
     */
    async findRecent(since: Date, limit: number): Promise<CatalogItemDocument[]> {
        return this.catalogModel
            .find({ createdAt: { $gte: since } })
            .sort({ createdAt: -1 })
            .limit(limit)
            .exec();
    }

    /**
     * Bulk fetch catalog items by their itemIds.
     * Used by bought-together, complete-the-look, and trending.
     */
    async findByIds(itemIds: string[]): Promise<CatalogItemDocument[]> {
        if (!itemIds.length) return [];
        return this.catalogModel
            .find({ itemId: { $in: itemIds } })
            .exec();
    }

    /**
     * Find items similar to a reference (same vendor OR overlapping tags).
     * Excludes specified item IDs. Used by getBoughtTogether().
     */
    async findSimilar(options: {
        excludeIds: string[];
        vendor?: string;
        tags?: string[];
        limit: number;
    }): Promise<CatalogItemDocument[]> {
        const query: any = {};
        if (options.excludeIds.length) {
            query.itemId = { $nin: options.excludeIds };
        }
        const orConditions: any[] = [];
        if (options.vendor) orConditions.push({ vendor: options.vendor });
        if (options.tags && options.tags.length) orConditions.push({ tags: { $in: options.tags } });
        if (orConditions.length) query.$or = orConditions;

        return this.catalogModel.find(query).limit(options.limit).exec();
    }

    /**
     * Find items of different types than those provided (to complete a look).
     * Excludes specified item IDs. Used by getCompleteTheLook().
     */
    async findByTypesExcluding(options: {
        excludeTypes: string[];
        excludeIds: string[];
        limit: number;
    }): Promise<CatalogItemDocument[]> {
        const query: any = {};
        if (options.excludeTypes.length) query.type = { $nin: options.excludeTypes };
        if (options.excludeIds.length) query.itemId = { $nin: options.excludeIds };

        return this.catalogModel.find(query).limit(options.limit).exec();
    }

    async update(itemId: string, updateData: Partial<CatalogItem>): Promise<CatalogItem | null> {
        return this.catalogModel.findOneAndUpdate({ itemId }, updateData, { new: true }).exec();
    }

    async delete(itemId: string): Promise<CatalogItem | null> {
        return this.catalogModel.findOneAndDelete({ itemId }).exec();
    }

    normalizeVendorListing(raw: any, source: string): CreateCatalogItemDto {
        this.logger.debug(`Normalizing listing from ${source}`);

        let normalized: Partial<CreateCatalogItemDto> = {
            vendor: source,
            rawVendorData: raw,
        };

        switch (source.toLowerCase()) {
            case 'shopify_csv':
                normalized = { ...normalized, ...this.normalizeShopify(raw) };
                break;
            case 'custom_api':
                normalized = { ...normalized, ...this.normalizeCustomApi(raw) };
                break;
            default:
                this.logger.warn(`Unknown source: ${source}, attempting generic normalization`);
                normalized = { ...normalized, ...this.normalizeGeneric(raw) };
        }

        // Validation or default values
        if (!normalized.itemId) throw new Error('Normalization failed: Missing itemId');
        if (!normalized.name) throw new Error('Normalization failed: Missing name');
        if (!normalized.price) normalized.price = 0;
        if (!normalized.currency) normalized.currency = 'USD';
        if (!normalized.type) normalized.type = CatalogItemType.GARMENT; // Default

        return normalized as CreateCatalogItemDto;
    }

    private normalizeShopify(raw: any): Partial<CreateCatalogItemDto> {
        return {
            itemId: raw.Variant_SKU || raw.Handle,
            name: raw.Title,
            description: raw.Body_HTML,
            price: parseFloat(raw.Variant_Price || '0'),
            currency: 'USD', // Assuming default
            type: CatalogItemType.GARMENT,
            tags: raw.Tags ? raw.Tags.split(',').map(t => t.trim()) : [],
            fitMeta: {
                fitType: raw['Option1 Value'] || 'regular',
                targetDemographic: 'unisex', // Simplified logic
            }
        };
    }

    private normalizeCustomApi(raw: any): Partial<CreateCatalogItemDto> {
        // Determine type based on category
        let type = CatalogItemType.GARMENT;
        if (raw.category === 'Fabrics') type = CatalogItemType.FABRIC;
        if (raw.category === 'Accessories') type = CatalogItemType.ACCESSORY;

        return {
            itemId: raw.id,
            name: raw.productName,
            description: raw.details,
            price: raw.cost,
            currency: raw.currencyCode || 'EUR',
            type: type,
            tags: raw.keywords || [],
            fitMeta: type === CatalogItemType.GARMENT ? {
                fitType: raw.fit,
                targetDemographic: raw.gender,
            } : undefined,
            material: raw.materialInfo,
        };
    }

    private normalizeGeneric(raw: any): Partial<CreateCatalogItemDto> {
        return {
            itemId: raw.id || raw.sku || raw.code,
            name: raw.name || raw.title,
            description: raw.description,
            price: Number(raw.price || 0),
            currency: raw.currency || 'USD',
            type: CatalogItemType.GARMENT,
        };
    }
}
