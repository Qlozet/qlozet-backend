import { Module } from '@nestjs/common';
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
import { BusinessModule } from '../../business/business.module';

import { FeedMixerService } from './feed-mixer/feed-mixer.service';

@Module({
  imports: [
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
  controllers: [RecommendationsController],
  providers: [RecommendationsService, FeedMixerService],
})
export class RecommendationsModule { }
