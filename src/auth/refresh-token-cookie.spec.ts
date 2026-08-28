import { ConfigService } from '@nestjs/config';
import {
  getLegacyRefreshTokenClearCookieOptions,
  getRefreshTokenClearCookieOptions,
  getRefreshTokenCookieOptions,
  REFRESH_TOKEN_COOKIE_PATH,
} from './refresh-token-cookie';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: string) =>
      key in values ? values[key] : defaultValue,
    ),
  } as unknown as ConfigService;
}

describe('refresh token cookie options', () => {
  it('aligns maxAge with JWT_REFRESH_EXPIRES_IN', () => {
    const options = getRefreshTokenCookieOptions(
      config({ JWT_REFRESH_EXPIRES_IN: '7d' }),
    );

    expect(options.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('uses Lax, the auth-only path and Secure in production', () => {
    const options = getRefreshTokenCookieOptions(
      config({ NODE_ENV: 'production', JWT_REFRESH_EXPIRES_IN: '7d' }),
    );

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
  });

  it('uses the same scope without maxAge when clearing the cookie', () => {
    const options = getRefreshTokenClearCookieOptions(
      config({ NODE_ENV: 'production', JWT_REFRESH_EXPIRES_IN: '7d' }),
    );

    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
  });

  it('can remove the legacy root-scoped production cookie', () => {
    const options = getLegacyRefreshTokenClearCookieOptions(
      config({ NODE_ENV: 'production' }),
    );

    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
  });
});
