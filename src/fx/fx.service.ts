import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_ARGENTINA_FX_CASA,
  isArgentinaFxCasa,
  isArsToUsdPair,
  isUsdToArsPair,
  toArgentinaDatosDatePath,
  type ArgentinaFxCasa,
} from './argentina-fx.constants';
import { toSafeErrorMessage } from '../common/utils/log-redaction.util';

export interface FxSnapshot {
  fxRateToBoardCurrency: number;
  fxCapturedAt: Date;
}

interface CachedFxRate {
  rate: number;
  expiresAt: number;
}

interface DolarApiQuoteResponse {
  compra?: number;
  venta?: number;
  fechaActualizacion?: string;
}

interface ArgentinaDatosQuoteResponse {
  compra?: number;
  venta?: number;
  fecha?: string;
}

interface ExchangeRateApiPairResponse {
  result?: string;
  conversion_rate?: number;
  'error-type'?: string;
}

interface HistoricalRateApiResponse {
  result?: string;
  conversion_rates?: Record<string, number>;
  'error-type'?: string;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly exchangeRateApiKey: string | undefined;
  private readonly exchangeRateApiBaseUrl: string;
  private readonly dolarApiBaseUrl: string;
  private readonly argentinaDatosBaseUrl: string;
  private readonly argentinaCasa: ArgentinaFxCasa;
  private readonly rateCache = new Map<string, CachedFxRate>();
  private readonly cacheTtlMs: number;
  private readonly historicalCacheTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    this.exchangeRateApiKey = this.configService.get<string>('FX_API_KEY');
    this.exchangeRateApiBaseUrl =
      this.configService.get<string>('FX_API_BASE_URL') ??
      'https://v6.exchangerate-api.com/v6';
    this.dolarApiBaseUrl =
      this.configService.get<string>('FX_DOLARAPI_BASE_URL') ??
      'https://dolarapi.com';
    this.argentinaDatosBaseUrl =
      this.configService.get<string>('FX_ARGENTINA_DATOS_BASE_URL') ??
      'https://api.argentinadatos.com';
    const casaConfig =
      this.configService.get<string>('FX_ARGENTINA_CASA') ??
      DEFAULT_ARGENTINA_FX_CASA;
    this.argentinaCasa = isArgentinaFxCasa(casaConfig)
      ? casaConfig
      : DEFAULT_ARGENTINA_FX_CASA;
    this.cacheTtlMs =
      Number(this.configService.get<string>('FX_CACHE_TTL_MS')) ||
      60 * 60 * 1000;
    this.historicalCacheTtlMs =
      Number(this.configService.get<string>('FX_HISTORICAL_CACHE_TTL_MS')) ||
      7 * 24 * 60 * 60 * 1000;

    if (!isArgentinaFxCasa(casaConfig)) {
      this.logger.warn(
        `FX_ARGENTINA_CASA inválida "${casaConfig}", usando "${DEFAULT_ARGENTINA_FX_CASA}"`,
      );
    }
  }

  /** True when automatic FX is available (Argentina USD/ARS or global API key). */
  isProviderEnabled(): boolean {
    return true;
  }

  isArgentinaProviderEnabled(): boolean {
    return true;
  }

  isGlobalProviderEnabled(): boolean {
    return !!this.exchangeRateApiKey;
  }

  getArgentinaCasa(): ArgentinaFxCasa {
    return this.argentinaCasa;
  }

  async resolveSnapshot(
    fromCurrency: string,
    toCurrency: string,
    manualRate?: number,
  ): Promise<FxSnapshot> {
    if (fromCurrency === toCurrency) {
      return {
        fxRateToBoardCurrency: 1,
        fxCapturedAt: new Date(),
      };
    }

    if (manualRate !== undefined) {
      if (manualRate <= 0) {
        throw new BadRequestException(
          'fxRateOverride debe ser un número mayor a 0',
        );
      }
      return {
        fxRateToBoardCurrency: manualRate,
        fxCapturedAt: new Date(),
      };
    }

    const rate = await this.fetchRate(fromCurrency, toCurrency);
    return {
      fxRateToBoardCurrency: rate,
      fxCapturedAt: new Date(),
    };
  }

  async resolveHistoricalSnapshot(
    fromCurrency: string,
    toCurrency: string,
    date: string,
    manualRate?: number,
  ): Promise<FxSnapshot> {
    if (fromCurrency === toCurrency) {
      return {
        fxRateToBoardCurrency: 1,
        fxCapturedAt: new Date(`${date}T12:00:00.000Z`),
      };
    }

    if (manualRate !== undefined) {
      if (manualRate <= 0) {
        throw new BadRequestException(
          'fxRateOverride debe ser un número mayor a 0',
        );
      }
      return {
        fxRateToBoardCurrency: manualRate,
        fxCapturedAt: new Date(`${date}T12:00:00.000Z`),
      };
    }

    const rate = await this.fetchHistoricalRate(fromCurrency, toCurrency, date);
    return {
      fxRateToBoardCurrency: rate,
      fxCapturedAt: new Date(`${date}T12:00:00.000Z`),
    };
  }

  private async fetchHistoricalRate(
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ): Promise<number> {
    if (isUsdToArsPair(fromCurrency, toCurrency)) {
      return this.fetchArgentinaHistoricalUsdToArs(date);
    }

    if (isArsToUsdPair(fromCurrency, toCurrency)) {
      const usdToArs = await this.fetchArgentinaHistoricalUsdToArs(date);
      return 1 / usdToArs;
    }

    if (!this.exchangeRateApiKey) {
      throw new BadRequestException(
        'Tipo de cambio histórico no disponible para este par de monedas. Usá fxRateOverride o configurá FX_API_KEY para pares distintos de USD/ARS.',
      );
    }

    return this.fetchExchangeRateApiHistorical(fromCurrency, toCurrency, date);
  }

  private async fetchRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    if (isUsdToArsPair(fromCurrency, toCurrency)) {
      return this.fetchArgentinaSpotUsdToArs();
    }

    if (isArsToUsdPair(fromCurrency, toCurrency)) {
      const usdToArs = await this.fetchArgentinaSpotUsdToArs();
      return 1 / usdToArs;
    }

    if (!this.exchangeRateApiKey) {
      throw new BadRequestException(
        'Tipo de cambio requerido: para USD/ARS se usa DolarApi automáticamente; para otras monedas enviá fxRateOverride o configurá FX_API_KEY.',
      );
    }

    return this.fetchExchangeRateApiPair(fromCurrency, toCurrency);
  }

  private async fetchArgentinaSpotUsdToArs(): Promise<number> {
    const cacheKey = `ar:spot:${this.argentinaCasa}:USD:ARS`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const url = `${this.dolarApiBaseUrl}/v1/dolares/${this.argentinaCasa}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error(
        `DolarApi request failed for casa ${this.argentinaCasa}`,
        toSafeErrorMessage(error),
      );
      throw new ServiceUnavailableException('No se pudo contactar a DolarApi');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'DolarApi no respondió correctamente',
      );
    }

    const data = (await response.json()) as DolarApiQuoteResponse;
    const rate = this.extractArgentinaSellRate(data);

    this.rateCache.set(cacheKey, {
      rate,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return rate;
  }

  private async fetchArgentinaHistoricalUsdToArs(
    isoDate: string,
  ): Promise<number> {
    const cacheKey = `ar:hist:${this.argentinaCasa}:USD:ARS:${isoDate}`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const datePath = toArgentinaDatosDatePath(isoDate);
    const url = `${this.argentinaDatosBaseUrl}/v1/cotizaciones/dolares/${this.argentinaCasa}/${datePath}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error(
        `ArgentinaDatos request failed for ${this.argentinaCasa} on ${isoDate}`,
        toSafeErrorMessage(error),
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar a ArgentinaDatos',
      );
    }

    if (!response.ok) {
      throw new BadRequestException(
        'No se pudo obtener el tipo de cambio histórico para la fecha indicada',
      );
    }

    const data = (await response.json()) as ArgentinaDatosQuoteResponse;
    const rate = this.extractArgentinaSellRate(data);

    this.rateCache.set(cacheKey, {
      rate,
      expiresAt: Date.now() + this.historicalCacheTtlMs,
    });

    return rate;
  }

  private extractArgentinaSellRate(data: {
    venta?: number;
    compra?: number;
  }): number {
    const rate = data.venta ?? data.compra;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException(
        'El proveedor de cotización devolvió una tasa inválida',
      );
    }
    return rate;
  }

  private async fetchExchangeRateApiHistorical(
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ): Promise<number> {
    const [year, month, day] = date.split('-');
    if (!year || !month || !day) {
      throw new BadRequestException(
        'Fecha histórica inválida para tipo de cambio',
      );
    }

    const cacheKey = `hist:${fromCurrency}:${toCurrency}:${date}`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const url = `${this.exchangeRateApiBaseUrl}/${this.exchangeRateApiKey}/history/${fromCurrency}/${toCurrency}/${year}/${month}/${day}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error(
        `FX historical request failed for ${fromCurrency}->${toCurrency} on ${date}`,
        toSafeErrorMessage(error),
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar al proveedor de tipos de cambio',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'El proveedor de tipos de cambio no respondió correctamente',
      );
    }

    const data = (await response.json()) as HistoricalRateApiResponse;

    if (data.result !== 'success' || !data.conversion_rates) {
      this.logger.warn(
        `FX historical error for ${fromCurrency}->${toCurrency} on ${date}: ${data['error-type'] ?? 'unknown'}`,
      );
      throw new BadRequestException(
        'No se pudo obtener el tipo de cambio histórico para la fecha indicada',
      );
    }

    const rate = data.conversion_rates[toCurrency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException(
        'El proveedor de tipos de cambio devolvió una tasa histórica inválida',
      );
    }

    this.rateCache.set(cacheKey, {
      rate,
      expiresAt: Date.now() + this.historicalCacheTtlMs,
    });

    return rate;
  }

  private async fetchExchangeRateApiPair(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    const cacheKey = `global:${fromCurrency}:${toCurrency}`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const url = `${this.exchangeRateApiBaseUrl}/${this.exchangeRateApiKey}/pair/${fromCurrency}/${toCurrency}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error(
        `FX provider request failed for ${fromCurrency}->${toCurrency}`,
        toSafeErrorMessage(error),
      );
      throw new ServiceUnavailableException(
        'No se pudo contactar al proveedor de tipos de cambio',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'El proveedor de tipos de cambio no respondió correctamente',
      );
    }

    const data = (await response.json()) as ExchangeRateApiPairResponse;

    if (data.result !== 'success' || data.conversion_rate == null) {
      this.logger.warn(
        `FX provider error for ${fromCurrency}->${toCurrency}: ${data['error-type'] ?? 'unknown'}`,
      );
      throw new BadRequestException(
        'No se pudo obtener el tipo de cambio para las monedas indicadas',
      );
    }

    if (
      typeof data.conversion_rate !== 'number' ||
      !Number.isFinite(data.conversion_rate) ||
      data.conversion_rate <= 0
    ) {
      throw new BadRequestException(
        'El proveedor de tipos de cambio devolvió una tasa inválida',
      );
    }

    this.rateCache.set(cacheKey, {
      rate: data.conversion_rate,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return data.conversion_rate;
  }
}
