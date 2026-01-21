import { Module } from '@nestjs/common';
import { RankersService } from './rankers.service';

@Module({
    providers: [RankersService],
    exports: [RankersService],
})
export class RankersModule { }
