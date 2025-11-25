import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CurrencyService {
  private readonly API_URL = 'https://api.unirateapi.com/api/rates';
  private readonly API_KEY = process.env.RATE_API_KEY;

  constructor(private readonly http: HttpService) {}

  async getRates(base: string, symbols: string[]) {
    if (!this.API_KEY) throw new BadRequestException('RATE_API_KEY missing');

    const url = `${this.API_URL}?api_key=${this.API_KEY}&base=${base}&symbols=${symbols.join(',')}`;

    const { data } = await firstValueFrom(this.http.get(url));
    return data;
  }

  async convert(amount: number, from: string, to: string) {
    const data = await this.getRates(from, [to]);
    const rate = data.rates[to];

    if (!rate)
      throw new BadRequestException(`Unable to convert ${from} to ${to}`);

    return {
      amount,
      from,
      to,
      rate,
      converted: amount * rate,
    };
  }
  async convertUsdTo(amountUsd: number, to: string) {
    const data = await this.getRates('USD', [to]);
    const rate = data.rates[to];
    return amountUsd * rate;
  }
}
