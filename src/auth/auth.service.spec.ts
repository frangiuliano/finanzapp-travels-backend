import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { AuthService } from './auth.service';
import { UserDocument } from '../users/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { UserPreferencesService } from '../users/user-preferences.service';

describe('AuthService security flows', () => {
  const registerDto = {
    email: 'New.User@example.com',
    username: 'new_user',
    password: 'ValidPass1',
    firstName: 'New',
    lastName: 'User',
  };

  function buildService() {
    const savedUser = {
      _id: { toString: () => 'user-id' },
      email: 'new.user@example.com',
      username: 'new_user',
      firstName: 'New',
      lastName: 'User',
      emailVerified: false,
      isActive: true,
      save: jest.fn().mockResolvedValue(undefined),
    };

    const userModel = Object.assign(
      jest.fn().mockImplementation(() => savedUser),
      {
        findOne: jest.fn(),
        findById: jest.fn(),
      },
    );
    const jwtService = {
      sign: jest.fn(),
      verify: jest.fn().mockReturnValue({ sub: 'user-id' }),
    };
    const notificationsService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AuthService(
      userModel as unknown as Model<UserDocument>,
      jwtService as unknown as JwtService,
      { get: jest.fn() } as unknown as ConfigService,
      notificationsService as unknown as NotificationsService,
      {} as UserPreferencesService,
    );

    return {
      service,
      savedUser,
      userModel,
      jwtService,
      notificationsService,
    };
  }

  it('registers an unverified account without issuing session tokens', async () => {
    const context = buildService();
    context.userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const result = await context.service.register(registerDto);

    expect(result).toEqual({
      message:
        'Cuenta creada. Revisa tu email para verificarla antes de iniciar sesión.',
      email: 'new.user@example.com',
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(context.jwtService.sign).not.toHaveBeenCalled();
    expect(
      context.notificationsService.sendVerificationEmail,
    ).toHaveBeenCalledWith('new.user@example.com', expect.any(String));
  });

  it('resends verification only for an active unverified account', async () => {
    const context = buildService();
    context.userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(context.savedUser),
    });

    await context.service.resendVerificationEmail(' NEW.USER@EXAMPLE.COM ');

    expect(context.userModel.findOne).toHaveBeenCalledWith({
      email: 'new.user@example.com',
    });
    expect(context.savedUser.save).toHaveBeenCalled();
    expect(
      context.notificationsService.sendVerificationEmail,
    ).toHaveBeenCalledWith('new.user@example.com', expect.any(String));
  });

  it.each([
    ['missing account', null],
    ['verified account', { emailVerified: true, isActive: true }],
    ['inactive account', { emailVerified: false, isActive: false }],
  ])('does not send for a %s', async (_label, account) => {
    const context = buildService();
    context.userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(account),
    });

    await expect(
      context.service.resendVerificationEmail('person@example.com'),
    ).resolves.toBeUndefined();
    expect(
      context.notificationsService.sendVerificationEmail,
    ).not.toHaveBeenCalled();
  });

  it('does not refresh a session for an unverified account', async () => {
    const context = buildService();
    context.userModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(context.savedUser),
      }),
    });

    await expect(context.service.refreshToken('refresh-token')).rejects.toThrow(
      'Debes verificar tu email antes de continuar',
    );
    expect(context.jwtService.sign).not.toHaveBeenCalled();
  });
});
