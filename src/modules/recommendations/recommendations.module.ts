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
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import {
  PlatformStyle,
  PlatformStyleSchema,
} from '../style-library/schemas/platform-style.schema';
import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: User.name, schema: UserSchema },
      // Stock thresholds for the availability attached to hydrated products.
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      // Sign-up style steps: stores to suggest, platform styles as looks.
      { name: Business.name, schema: BusinessSchema },
      { name: PlatformStyle.name, schema: PlatformStyleSchema },
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
  ],
  controllers: [RecommendationsController, OnboardingController],
  providers: [RecommendationsService, FeedMixerService, OnboardingService],
})
export class RecommendationsModule {}
