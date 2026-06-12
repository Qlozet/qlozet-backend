import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';

@Module({
  imports: [HttpModule],
  controllers: [CurrencyController],
  providers: [CurrencyService],
  exports: [CurrencyService],
})
export class CurrencyModule {}
