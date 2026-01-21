import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserEmbeddingDocument = HydratedDocument<UserEmbedding>;

@Schema({ timestamps: true, collection: 'user_embeddings' })
export class UserEmbedding {
    @Prop({ required: true, unique: true, index: true })
    userId: string;

    @Prop({ type: [Number], required: true })
    u_style: number[];

    @Prop({ type: [Number] })
    u_fit?: number[];

    @Prop({ type: Object })
    scalars?: {
        fit_preference?: string;
        [key: string]: any;
    };

    @Prop({ type: Object })
    confidence_by_facet?: Record<string, number>;

    @Prop()
    version: string;

    @Prop()
    lastUpdated: Date;
}

export const UserEmbeddingSchema = SchemaFactory.createForClass(UserEmbedding);
