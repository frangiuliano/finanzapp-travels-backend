import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { UserDocument } from '../../users/user.schema';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  function buildStrategy(user: Partial<UserDocument> | null) {
    const userModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(user),
      }),
    };
    const configService = {
      get: jest.fn().mockReturnValue('test-jwt-secret'),
    };

    return new JwtStrategy(
      configService as unknown as ConfigService,
      userModel as unknown as Model<UserDocument>,
    );
  }

  it('rejects an active user whose email is not verified', async () => {
    const strategy = buildStrategy({ isActive: true, emailVerified: false });

    await expect(
      strategy.validate({ sub: 'user-id', email: 'user@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts an active user whose email is verified', async () => {
    const user = {
      isActive: true,
      emailVerified: true,
      authVersion: 0,
    } as UserDocument;
    const strategy = buildStrategy(user);

    await expect(
      strategy.validate({ sub: 'user-id', email: 'user@example.com' }),
    ).resolves.toBe(user);
  });

  it('rejects an access token issued before session revocation', async () => {
    const strategy = buildStrategy({
      isActive: true,
      emailVerified: true,
      authVersion: 2,
    });

    await expect(
      strategy.validate({
        sub: 'user-id',
        email: 'old@example.com',
        authVersion: 1,
      }),
    ).rejects.toThrow('La sesión ya no es válida');
  });
});
