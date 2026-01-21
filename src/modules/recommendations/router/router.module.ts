import { Module } from '@nestjs/common';
import { RouterService } from './router.service';
import { RouterController } from './router.controller';
import { ConfigModule } from '@nestjs/config';
import { UserEmbeddingsModule } from '../user-embeddings/user-embeddings.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { FiltersModule } from '../filters/filters.module';
import { RankersModule } from '../rankers/rankers.module';
import { ExplanationsModule } from '../explanations/explanations.module';
import { EventsModule } from '../events/events.module';
import { BusinessModule } from '../../business/business.module';

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
    ],
    controllers: [RouterController],
    providers: [RouterService],
})
export class RouterModule { }
