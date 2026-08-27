import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstrumentType } from './wealth.schemas';

export interface MarketInstrumentMatch {
  symbol: string;
  name: string;
  type: InstrumentType;
  currency: string;
  exchange: string;
  micCode?: string;
  provider: 'twelve_data';
  providerSymbol: string;
}

interface TwelveDataSearchResponse {
  status?: string;
  message?: string;
  data?: Array<{
    symbol?: string;
    instrument_name?: string;
    instrument_type?: string;
    currency?: string;
    exchange?: string;
    mic_code?: string;
    country?: string;
  }>;
}

interface TwelveDataPriceResponse {
  price?: string;
  status?: string;
  message?: string;
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly searchCache = new Map<
    string,
    { expiresAt: number; results: MarketInstrumentMatch[] }
  >();
  private readonly cacheTtlMs: number;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('TWELVE_DATA_API_KEY')?.trim();
    this.baseUrl =
      configService.get<string>('TWELVE_DATA_API_BASE_URL')?.trim() ||
      'https://api.twelvedata.com';
    this.cacheTtlMs =
      Number(configService.get<string>('MARKET_DATA_SEARCH_CACHE_TTL_MS')) ||
      24 * 60 * 60 * 1000;
  }

  isEnabled() {
    return Boolean(this.apiKey);
  }

  async search(
    search: string,
    currency?: string,
  ): Promise<MarketInstrumentMatch[]> {
    const query = search.trim();
    if (!this.apiKey || query.length < 2) {
      return [];
    }
    const cacheKey = `${query.toUpperCase()}|${currency?.toUpperCase() || '*'}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;

    try {
      const url = new URL('/symbol_search', this.baseUrl);
      url.searchParams.set('symbol', query);
      url.searchParams.set('outputsize', '20');
      url.searchParams.set('apikey', this.apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as TwelveDataSearchResponse;
      if (payload.status === 'error') {
        throw new Error(payload.message || 'Respuesta inválida');
      }
      const requestedCurrency = currency?.toUpperCase();
      const results = (payload.data ?? [])
        .filter(
          (item) =>
            item.symbol &&
            item.instrument_name &&
            item.currency &&
            item.exchange &&
            (!requestedCurrency ||
              item.currency.toUpperCase() === requestedCurrency),
        )
        .map((item) => ({
          symbol: item.symbol!.toUpperCase(),
          name: item.instrument_name!.trim(),
          type: this.mapInstrumentType(item.instrument_type),
          currency: item.currency!.toUpperCase(),
          exchange: item.exchange!.toUpperCase(),
          micCode: item.mic_code?.toUpperCase(),
          provider: 'twelve_data' as const,
          providerSymbol: item.symbol!,
        }));
      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        results,
      });
      return results;
    } catch (error) {
      this.logger.warn(
        `Twelve Data search failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return [];
    }
  }

  async getLatestPrice(symbol: string, exchange?: string): Promise<number> {
    if (!this.apiKey) throw new Error('Twelve Data no está configurado');
    const url = new URL('/price', this.baseUrl);
    url.searchParams.set('symbol', symbol);
    if (exchange) url.searchParams.set('exchange', exchange);
    url.searchParams.set('apikey', this.apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as TwelveDataPriceResponse;
    const price = Number(payload.price);
    if (payload.status === 'error' || !Number.isFinite(price) || price < 0) {
      throw new Error(payload.message || 'Cotización no disponible');
    }
    return price;
  }

  private mapInstrumentType(value?: string): InstrumentType {
    const normalized = value?.toLowerCase() ?? '';
    if (normalized.includes('etf')) return InstrumentType.ETF;
    if (normalized.includes('depositary')) return InstrumentType.CEDEAR;
    if (normalized.includes('stock') || normalized.includes('equity')) {
      return InstrumentType.STOCK;
    }
    if (normalized.includes('crypto') || normalized.includes('digital')) {
      return InstrumentType.CRYPTO;
    }
    if (normalized.includes('bond')) return InstrumentType.BOND;
    if (normalized.includes('fund')) return InstrumentType.MUTUAL_FUND;
    return InstrumentType.OTHER;
  }
}
