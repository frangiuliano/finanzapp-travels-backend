import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { TelegramClientService } from './telegram-client.service';

describe('TelegramClientService external requests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(): TelegramClientService {
    const values: Record<string, string> = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
    };
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return new TelegramClientService(configService);
  }

  it('adds an abort signal when sending a message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
    }) as unknown as typeof fetch;

    await createService().sendMessage(123, 'mensaje');

    const fetchMock = jest.mocked(global.fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('handles a Telegram timeout without throwing or logging raw errors', async () => {
    const timeout = new Error('sensitive provider details');
    timeout.name = 'TimeoutError';
    global.fetch = jest
      .fn()
      .mockRejectedValue(timeout) as unknown as typeof fetch;
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(
      createService().sendMessage(123, 'mensaje'),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Telegram no respondió a tiempo en sendMessage',
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
