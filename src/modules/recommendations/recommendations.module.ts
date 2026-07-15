import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { EventsModule } from './events/events.module';
import { CatalogModule } from './catalog/catalog.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { UserEmbeddingsModule } from './user-embeddings/user-embeddings.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { FiltersModule } from './filters/filters.module';
import { RankersModule } from './rankers/rankers.module';
import { ExplanationsModule } from './explanations/explanations.module';
import { RouterModule } from './router/router.module';
import { EvaluationModule } from './evaluation/evaluation.module';

import { FeedMixerService } from './feed-mixer/feed-mixer.service';
import { BusinessModule } from '../business/business.module';
import { Order, OrderSchema } from '../orders/schemas/orders.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';

import { SizeGuideModule } from '../size-guide/size-guide.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EventsModule,
    CatalogModule,
    EmbeddingsModule,
    UserEmbeddingsModule,
    RetrievalModule,
    FiltersModule,
    RankersModule,
    ExplanationsModule,
    RouterModule,
    EvaluationModule,
    BusinessModule,
    SizeGuideModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, FeedMixerService],
})
export class RecommendationsModule {}
