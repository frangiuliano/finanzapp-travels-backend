import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FxService } from './fx.service';

describe('FxService', () => {
  const originalFetch = global.fetch;

  function expectFetchWithSignal(expectedUrl: string): void {
    const fetchMock = jest.mocked(global.fetch);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe(expectedUrl);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function createService(
    config: Record<string, string> = {},
  ): Promise<FxService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();

    return module.get(FxService);
  }

  it('returns rate 1 when currencies match', async () => {
    const service = await createService();
    const snapshot = await service.resolveSnapshot('ARS', 'ARS');

    expect(snapshot.fxRateToBoardCurrency).toBe(1);
    expect(snapshot.fxCapturedAt).toBeInstanceOf(Date);
  });

  it('uses manual override without any API key', async () => {
    const service = await createService();
    const snapshot = await service.resolveSnapshot('USD', 'ARS', 1200);

    expect(snapshot.fxRateToBoardCurrency).toBe(1200);
  });

  it('fetches USD/ARS from DolarApi without API key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          venta: 1250.5,
          compra: 1240,
          fechaActualizacion: '2026-03-15T10:00:00.000Z',
        }),
    }) as unknown as typeof fetch;

    const service = await createService();
    const snapshot = await service.resolveSnapshot('USD', 'ARS');

    expect(snapshot.fxRateToBoardCurrency).toBe(1250.5);
    expectFetchWithSignal('https://dolarapi.com/v1/dolares/oficial');
  });

  it('fetches historical USD/ARS from ArgentinaDatos', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          venta: 1180,
          compra: 1170,
          fecha: '2026-02-14',
        }),
    }) as unknown as typeof fetch;

    const service = await createService();
    const snapshot = await service.resolveHistoricalSnapshot(
      'USD',
      'ARS',
      '2026-02-14',
    );

    expect(snapshot.fxRateToBoardCurrency).toBe(1180);
    expectFetchWithSignal(
      'https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/2026/02/14',
    );
  });

  it('requires manual override for non-USD/ARS pairs without global API key', async () => {
    const service = await createService();

    await expect(service.resolveSnapshot('EUR', 'ARS')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fetches non-USD/ARS pairs from exchangerate-api when API key is configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: 'success',
          conversion_rate: 1150.5,
        }),
    }) as unknown as typeof fetch;

    const service = await createService({ FX_API_KEY: 'test-key' });
    const snapshot = await service.resolveSnapshot('EUR', 'ARS');

    expect(snapshot.fxRateToBoardCurrency).toBe(1150.5);
    expectFetchWithSignal(
      'https://v6.exchangerate-api.com/v6/test-key/pair/EUR/ARS',
    );
  });

  it('reuses cached rate for repeated USD/ARS requests', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          venta: 1100,
        }),
    }) as unknown as typeof fetch;

    const service = await createService();
    await service.resolveSnapshot('USD', 'ARS');
    await service.resolveSnapshot('USD', 'ARS');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('isProviderEnabled returns true without API key', async () => {
    const service = await createService();
    expect(service.isProviderEnabled()).toBe(true);
  });

  it('returns service unavailable with a clear message on provider timeout', async () => {
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    global.fetch = jest
      .fn()
      .mockRejectedValue(timeout) as unknown as typeof fetch;
    const service = await createService();

    await expect(service.resolveSnapshot('USD', 'ARS')).rejects.toThrow(
      new ServiceUnavailableException('DolarApi no respondió a tiempo'),
    );
  });
});
