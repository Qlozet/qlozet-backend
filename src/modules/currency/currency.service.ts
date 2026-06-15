import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly API_URL = 'https://api.unirateapi.com/api/rates';
  private readonly API_KEY = process.env.RATE_API_KEY;

  // Cache rates for 10 minutes to avoid rate-limiting
  private rateCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly http: HttpService) {}

  async getRates(base: string, symbols: string[]) {
    if (!this.API_KEY) throw new BadRequestException('RATE_API_KEY missing');

    const cacheKey = `${base}:${symbols.sort().join(',')}`;
    const cached = this.rateCache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    try {
      const url = `${this.API_URL}?api_key=${this.API_KEY}&base=${base}&symbols=${symbols.join(',')}`;

      const { data } = await firstValueFrom(this.http.get(url));

      this.rateCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return data;
    } catch (error) {
      this.logger.warn(`Exchange rate API failed (${error.message}), using stale cache`);
      if (cached) return cached.data;
      // Hardcoded fallback for first-ever call when no cache exists
      this.logger.warn('No cached rate available, using hardcoded fallback');
      const fallbackRates: Record<string, number> = { USD: 1, NGN: 1650, GBP: 0.79, EUR: 0.92 };
      return { rates: { [symbols[0]]: fallbackRates[symbols[0]] || 1 } };
    }
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
