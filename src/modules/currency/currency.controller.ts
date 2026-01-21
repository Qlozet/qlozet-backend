import { Controller, Get, Query } from '@nestjs/common';
import { CurrencyService } from './currency.service';

@Controller('currency')
export class CurrencyController {
  constructor(private readonly service: CurrencyService) {}

  @Get('rates')
  async rates(@Query('base') base: string, @Query('symbols') symbols: string) {
    return this.service.getRates(base, symbols.split(','));
  }

  @Get('convert')
  async convert(
    @Query('amount') amount: number,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.convert(Number(amount), from, to);
  }
}
