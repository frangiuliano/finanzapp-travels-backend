import { ConfigService } from '@nestjs/config';
import { InstrumentType } from './wealth.schemas';
import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
  afterEach(() => jest.restoreAllMocks());

  const configuredService = () =>
    new MarketDataService({
      get: jest.fn((key: string) =>
        key === 'TWELVE_DATA_API_KEY' ? 'test-key' : undefined,
      ),
    } as unknown as ConfigService);

  it('does not consume provider credits for incomplete searches', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(configuredService().search('S', 'ARS')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normalizes and caches international symbol matches', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'ok',
        data: [
          {
            symbol: 'SPY',
            instrument_name: 'SPDR S&P 500 ETF',
            instrument_type: 'ETF',
            currency: 'USD',
            exchange: 'NYSE',
            mic_code: 'ARCX',
            country: 'United States',
          },
        ],
      }),
    } as unknown as Response);
    const service = configuredService();

    const first = await service.search('spy', 'USD');
    const second = await service.search('spy', 'USD');

    expect(first).toEqual([
      expect.objectContaining({
        symbol: 'SPY',
        type: InstrumentType.ETF,
        provider: 'twelve_data',
      }),
    ]);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reads the latest provider price', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ price: '123.45' }),
    } as unknown as Response);

    await expect(
      configuredService().getLatestPrice('SPY', 'NYSE'),
    ).resolves.toBe(123.45);
  });

  it('includes Argentine instruments when the holding is in ARS', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'ok',
        data: [
          {
            symbol: 'COST',
            instrument_name: 'Costco Wholesale Corporation CEDEAR',
            instrument_type: 'Depositary Receipt',
            currency: 'ARS',
            exchange: 'BCBA',
            country: 'Argentina',
          },
        ],
      }),
    } as unknown as Response);

    await expect(configuredService().search('COST', 'ARS')).resolves.toEqual([
      expect.objectContaining({
        symbol: 'COST',
        currency: 'ARS',
        exchange: 'BCBA',
      }),
    ]);
  });
});
