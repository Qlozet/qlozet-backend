import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CatalogItemType } from '../enums/catalog-item-type.enum';

export type CatalogItemDocument = HydratedDocument<CatalogItem>;

@Schema({ _id: false })
export class FitMeta {
    @Prop()
    targetDemographic: string; // e.g., 'mens', 'womens', 'unisex'

    @Prop()
    fitType: string; // e.g., 'slim', 'regular', 'oversized'

    @Prop([String])
    measurementsPoints: string[]; // e.g., ['chest', 'waist']
}

@Schema({ _id: false })
export class Embeddings {
    @Prop([Number])
    e_style?: number[];

    @Prop([Number])
    e_fabric?: number[];
}

@Schema({ _id: false })
export class EmbeddingMetadata {
    @Prop()
    model: string;

    @Prop()
    dim: number;

    @Prop()
    version: string;

    @Prop()
    embedded_at: Date;
}

@Schema({ timestamps: true, collection: 'catalog_items' })
export class CatalogItem {
    @Prop({ required: true, unique: true, index: true })
    itemId: string;

    @Prop({ required: true, type: String, enum: CatalogItemType, index: true })
    type: CatalogItemType;

    @Prop({ required: true })
    name: string;

    @Prop()
    description: string;

    @Prop([String])
    tags: string[];

    // Normalized price field
    @Prop({ required: true })
    price: number;

    @Prop({ required: true })
    currency: string;

    // Vendor info
    @Prop({ required: true })
    vendor: string;

    @Prop()
    vendorUrl: string;

    @Prop({ type: Object })
    rawVendorData: Record<string, any>; // Store original data

    // Type-specific fields
    @Prop({ type: FitMeta })
    fitMeta?: FitMeta; // Only for garments

    @Prop()
    fabricComposition?: string; // For garments and fabrics

    @Prop()
    material?: string; // For accessories

    @Prop()
    templateUrl?: string; // For design templates

    @Prop({ type: Embeddings })
    embeddings?: Embeddings;

    @Prop({ type: EmbeddingMetadata })
    embeddingMetadata?: EmbeddingMetadata;
}

export const CatalogItemSchema = SchemaFactory.createForClass(CatalogItem);
