import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RouterService } from './router.service';
import { RouterController } from './router.controller';
import { AskService } from './ask.service';
import { GuardrailsService } from './guardrails.service';
import { ConfigModule } from '@nestjs/config';
import { UserEmbeddingsModule } from '../user-embeddings/user-embeddings.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { FiltersModule } from '../filters/filters.module';
import { RankersModule } from '../rankers/rankers.module';
import { ExplanationsModule } from '../explanations/explanations.module';
import { EventsModule } from '../events/events.module';
import { BusinessModule } from '../../business/business.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { WalletsModule } from '../../wallets/wallets.module';
import { DatabaseModule } from 'src/database/database.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { PlatformModule } from 'src/modules/platform/platform.module';
import { Product, ProductSchema } from '../../products/schemas/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
    ConfigModule,
    UserEmbeddingsModule,
    RetrievalModule,
    FiltersModule,
    RankersModule,
    ExplanationsModule,
    EventsModule,
    BusinessModule,
    EmbeddingsModule,
    WalletsModule,
    DatabaseModule,
    AuthModule,
    PlatformModule,    // provides PlatformService (needed by RouterController)
  ],
  controllers: [RouterController],
  providers: [RouterService, AskService, GuardrailsService],
  exports: [RouterService, AskService],
})
export class RouterModule {}
