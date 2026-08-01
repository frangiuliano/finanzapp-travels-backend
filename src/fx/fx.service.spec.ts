import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FxService } from './fx.service';

describe('FxService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function createService(apiKey?: string): Promise<FxService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'FX_API_KEY') {
                return apiKey;
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    return module.get(FxService);
  }

  it('returns rate 1 when currencies match', async () => {
    const service = await createService('test-key');
    const snapshot = await service.resolveSnapshot('ARS', 'ARS');

    expect(snapshot.fxRateToBoardCurrency).toBe(1);
    expect(snapshot.fxCapturedAt).toBeInstanceOf(Date);
  });

  it('uses manual override without API key', async () => {
    const service = await createService();
    const snapshot = await service.resolveSnapshot('USD', 'ARS', 1200);

    expect(snapshot.fxRateToBoardCurrency).toBe(1200);
  });

  it('requires manual override when API key is missing', async () => {
    const service = await createService();

    await expect(service.resolveSnapshot('USD', 'ARS')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fetches rate from provider when API key is configured', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: 'success',
          conversion_rate: 1150.5,
        }),
    }) as unknown as typeof fetch;

    const service = await createService('test-key');
    const snapshot = await service.resolveSnapshot('USD', 'ARS');

    expect(snapshot.fxRateToBoardCurrency).toBe(1150.5);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://v6.exchangerate-api.com/v6/test-key/pair/USD/ARS',
    );
  });

  it('reuses cached rate for repeated currency pairs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: 'success',
          conversion_rate: 1100,
        }),
    }) as unknown as typeof fetch;

    const service = await createService('test-key');
    await service.resolveSnapshot('USD', 'ARS');
    await service.resolveSnapshot('USD', 'ARS');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
