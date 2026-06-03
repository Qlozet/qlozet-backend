import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
  ],
  controllers: [RouterController],
  providers: [RouterService, AskService, GuardrailsService],
  exports: [RouterService, AskService],
})
export class RouterModule {}
