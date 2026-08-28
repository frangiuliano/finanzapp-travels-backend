import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';
import * as ms from 'ms';

export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

export function getRefreshTokenCookieOptions(
  configService: ConfigService,
): CookieOptions & { maxAge: number } {
  const expiresIn = configService.get<string>('JWT_REFRESH_EXPIRES_IN', '30d');
  const maxAge = ms(expiresIn as ms.StringValue);

  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    throw new Error('JWT_REFRESH_EXPIRES_IN must be a positive duration');
  }

  return {
    httpOnly: true,
    secure: configService.get<string>('NODE_ENV') === 'production',
    sameSite: 'lax',
    maxAge,
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
}

export function getRefreshTokenClearCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const options = getRefreshTokenCookieOptions(configService);

  return {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  };
}

export function getLegacyRefreshTokenClearCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  };
}
