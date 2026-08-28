import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { FxRate, FxRateDocument } from './schemas/fx-rate.schema';

/** A locked FX quote for a charge: mid-market + markup. */
export interface FxQuote {
  from: string;
  to: string;
  /** Mid-market rate at quote time. */
  rate: number;
  /** Markup applied on top (percent). */
  markup_percent: number;
  /** rate × (1 + markup) — the rate actually stamped on the order. */
  effective_rate: number;
  quoted_at: Date;
}

// How stale a DB last-good rate may be and still back a real charge.
const CHARGE_LAST_GOOD_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly API_URL = 'https://api.unirateapi.com/api/rates';
  private readonly API_KEY = process.env.RATE_API_KEY;

  // Cache rates for 10 minutes to avoid rate-limiting
  private rateCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly http: HttpService,
    @InjectModel(FxRate.name)
    private readonly fxRateModel: Model<FxRateDocument>,
  ) {}

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

      // UniRate IGNORES the `base` query param — it always answers with a
      // USD-based table of every currency. Derive the rates the caller
      // actually asked for: base→sym = table[sym] / table[base] (the
      // response's own base counts as 1). Cache/persist the normalized rates.
      const normalized = this.normalizeRates(data, base, symbols);

      this.rateCache.set(cacheKey, {
        data: normalized,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      // Persist last-good per pair so charge-path quotes survive restarts and
      // short API outages (fire-and-forget; a write failure never blocks).
      const now = new Date();
      for (const sym of symbols) {
        const r = normalized.rates[sym];
        if (typeof r === 'number' && r > 0) {
          this.fxRateModel
            .updateOne(
              { base, symbol: sym },
              { $set: { rate: r, fetched_at: now } },
              { upsert: true },
            )
            .catch((e) =>
              this.logger.warn(`FxRate persist failed: ${e.message}`),
            );
        }
      }

      return normalized;
    } catch (error) {
      this.logger.warn(`Exchange rate API failed (${error.message}), using stale cache`);
      if (cached) return cached.data;
      // Hardcoded fallback for first-ever call when no cache exists. The table
      // is USD-BASED, so cross rates must be derived (base→symbol =
      // usd[symbol] / usd[base]) — returning the raw table entry for a non-USD
      // base produced nonsense like NGN→USD = 1, which made converted prices
      // show a new symbol with an unchanged number.
      this.logger.warn('No cached rate available, using hardcoded fallback');
      const usdBased: Record<string, number> = { USD: 1, NGN: 1650, GBP: 0.79, EUR: 0.92 };
      const baseUsd = usdBased[base.toUpperCase()];
      const rates: Record<string, number> = {};
      for (const sym of symbols) {
        const symUsd = usdBased[sym.toUpperCase()];
        rates[sym] = baseUsd && symUsd ? symUsd / baseUsd : 1;
      }
      return { rates };
    }
  }

  /**
   * Convert a provider response (whatever base it actually used) into the
   * rates the caller asked for. `base→sym = table[sym] / table[base]`, where
   * the response's own base currency counts as 1.
   */
  private normalizeRates(
    data: any,
    base: string,
    symbols: string[],
  ): { base: string; rates: Record<string, number> } {
    const table: Record<string, number> = data?.rates ?? {};
    const apiBase = String(data?.base ?? base).toUpperCase();
    const want = base.toUpperCase();
    const valueOf = (ccy: string): number | undefined =>
      ccy === apiBase ? 1 : table[ccy];

    const baseVal = valueOf(want);
    const rates: Record<string, number> = {};
    for (const sym of symbols) {
      const symVal = valueOf(sym.toUpperCase());
      if (
        typeof symVal === 'number' &&
        typeof baseVal === 'number' &&
        baseVal > 0
      ) {
        rates[sym] = symVal / baseVal;
      }
    }
    return { base: want, rates };
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

  /**
   * Charge-path FX quote: mid-market + markup, FAIL CLOSED.
   *
   * Unlike getRates()/convert() — which may fall back to hardcoded rates and
   * are fine for display — this never invents a rate for real money. Order of
   * preference: live API → in-memory cache (≤10 min) → DB last-good (≤24h).
   * If none is available it throws, and the checkout should surface "pricing
   * temporarily unavailable" rather than charging at a guessed rate.
   */
  async quote(
    from: string,
    to: string,
    markupPercent = 0,
  ): Promise<FxQuote> {
    const base = from.toUpperCase();
    const symbol = to.toUpperCase();
    if (base === symbol) {
      return {
        from: base,
        to: symbol,
        rate: 1,
        markup_percent: 0,
        effective_rate: 1,
        quoted_at: new Date(),
      };
    }

    let rate: number | undefined;
    try {
      const data = await this.getRatesStrict(base, symbol);
      rate = data;
    } catch {
      // Fall through to the DB last-good below.
    }

    if (rate === undefined) {
      const lastGood = await this.fxRateModel
        .findOne({ base, symbol })
        .lean();
      if (
        lastGood &&
        Date.now() - new Date(lastGood.fetched_at).getTime() <=
          CHARGE_LAST_GOOD_MAX_AGE_MS
      ) {
        this.logger.warn(
          `FX quote ${base}->${symbol} using DB last-good from ${lastGood.fetched_at}`,
        );
        rate = lastGood.rate;
      }
    }

    if (rate === undefined || rate <= 0) {
      throw new BadRequestException(
        `Exchange rate for ${base}->${symbol} is temporarily unavailable.`,
      );
    }

    const effective = rate * (1 + markupPercent / 100);
    return {
      from: base,
      to: symbol,
      rate,
      markup_percent: markupPercent,
      effective_rate: effective,
      quoted_at: new Date(),
    };
  }

  /** Live/cached rate WITHOUT the hardcoded fallback — throws on failure. */
  private async getRatesStrict(base: string, symbol: string): Promise<number> {
    if (!this.API_KEY) throw new BadRequestException('RATE_API_KEY missing');

    const cacheKey = `${base}:${symbol}`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      const r = cached.data?.rates?.[symbol];
      if (typeof r === 'number' && r > 0) return r;
    }

    const url = `${this.API_URL}?api_key=${this.API_KEY}&base=${base}&symbols=${symbol}`;
    const { data } = await firstValueFrom(this.http.get(url));
    // Same base-normalization as getRates — UniRate answers USD-based
    // regardless of the requested base.
    const normalized = this.normalizeRates(data, base, [symbol]);
    const r = normalized.rates[symbol];
    if (typeof r !== 'number' || r <= 0) {
      throw new BadRequestException(`No rate for ${base}->${symbol}`);
    }

    this.rateCache.set(cacheKey, {
      data: normalized,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
    this.fxRateModel
      .updateOne(
        { base, symbol },
        { $set: { rate: r, fetched_at: new Date() } },
        { upsert: true },
      )
      .catch((e) => this.logger.warn(`FxRate persist failed: ${e.message}`));

    return r;
  }
}
