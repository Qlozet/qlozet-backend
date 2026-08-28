import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';
import { FxRate, FxRateSchema } from './schemas/fx-rate.schema';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([{ name: FxRate.name, schema: FxRateSchema }]),
  ],
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
