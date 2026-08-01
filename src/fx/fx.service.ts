import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FxSnapshot {
  fxRateToBoardCurrency: number;
  fxCapturedAt: Date;
}

interface CachedFxRate {
  rate: number;
  expiresAt: number;
}

interface ExchangeRateApiPairResponse {
  result?: string;
  conversion_rate?: number;
  'error-type'?: string;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly enabled: boolean;
  private readonly apiKey: string | undefined;
  private readonly apiBaseUrl: string;
  private readonly rateCache = new Map<string, CachedFxRate>();
  private readonly cacheTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FX_API_KEY');
    this.enabled = !!this.apiKey;
    this.apiBaseUrl =
      this.configService.get<string>('FX_API_BASE_URL') ??
      'https://v6.exchangerate-api.com/v6';
    this.cacheTtlMs =
      Number(this.configService.get<string>('FX_CACHE_TTL_MS')) ||
      60 * 60 * 1000;

    if (!this.enabled) {
      this.logger.warn(
        'FX_API_KEY no configurada: gastos en moneda distinta al tablero requieren fxRateOverride',
      );
    }
  }

  isProviderEnabled(): boolean {
    return this.enabled;
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

    if (!this.enabled) {
      throw new BadRequestException(
        'Tipo de cambio requerido: configura FX_API_KEY o envía fxRateOverride al crear el gasto',
      );
    }

    const rate = await this.fetchRate(fromCurrency, toCurrency);
    return {
      fxRateToBoardCurrency: rate,
      fxCapturedAt: new Date(),
    };
  }

  private async fetchRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    const cacheKey = `${fromCurrency}:${toCurrency}`;
    const cached = this.rateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    const url = `${this.apiBaseUrl}/${this.apiKey}/pair/${fromCurrency}/${toCurrency}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.error(
        `FX provider request failed for ${fromCurrency}->${toCurrency}`,
        error,
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
