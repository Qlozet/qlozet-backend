import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TestUserDocument = HydratedDocument<TestUser>;

@Schema()
export class TestUser {
    @Prop({ required: true })
    full_name: string;
}

export const TestUserSchema = SchemaFactory.createForClass(TestUser);
