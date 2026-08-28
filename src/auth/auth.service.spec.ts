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
      authVersion: 0,
      refreshTokens: ['stored-token'],
      pendingEmail: undefined as string | undefined,
      pendingEmailToken: undefined as string | undefined,
      pendingEmailExpires: undefined as Date | undefined,
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
      sendEmailChangeConfirmation: jest.fn().mockResolvedValue(undefined),
      sendEmailChangeRequestedNotice: jest.fn().mockResolvedValue(undefined),
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

  it.each([
    ['email', [{ email: 'new.user@example.com' }]],
    ['username', [null, { username: 'new_user' }]],
  ])(
    'uses the same conflict response for an existing %s',
    async (_field, results) => {
      const context = buildService();
      for (const result of results) {
        context.userModel.findOne.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(result),
        });
      }

      await expect(context.service.register(registerDto)).rejects.toThrow(
        'No se pudo crear la cuenta con los datos indicados',
      );
    },
  );

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

  it('keeps the current email while requesting confirmation of a new one', async () => {
    const context = buildService();
    context.savedUser.emailVerified = true;
    context.userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(context.savedUser),
    });
    context.userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const result = await context.service.updateProfile('user-id', {
      firstName: 'New',
      lastName: 'User',
      email: 'Changed@Example.com',
    });

    expect(result.email).toBe('new.user@example.com');
    expect(result.pendingEmail).toBe('changed@example.com');
    expect(context.savedUser.email).toBe('new.user@example.com');
    expect(
      context.notificationsService.sendEmailChangeConfirmation,
    ).toHaveBeenCalledWith('changed@example.com', expect.any(String));
    expect(
      context.notificationsService.sendEmailChangeRequestedNotice,
    ).toHaveBeenCalledWith('new.user@example.com', 'changed@example.com');
  });

  it('confirms the pending email and invalidates every session', async () => {
    const context = buildService();
    context.savedUser.pendingEmail = 'changed@example.com';
    context.savedUser.pendingEmailToken = 'hashed-token';
    context.savedUser.pendingEmailExpires = new Date(Date.now() + 60_000);
    context.userModel.findOne
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(context.savedUser),
        }),
      })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });

    await context.service.confirmEmailChange('raw-token');

    expect(context.savedUser.email).toBe('changed@example.com');
    expect(context.savedUser.pendingEmail).toBeUndefined();
    expect(context.savedUser.refreshTokens).toEqual([]);
    expect(context.savedUser.authVersion).toBe(1);
    expect(context.savedUser.save).toHaveBeenCalled();
  });

  it('cancels a pending email change and invalidates its confirmation token', async () => {
    const context = buildService();
    context.savedUser.pendingEmail = 'changed@example.com';
    context.savedUser.pendingEmailToken = 'hashed-token';
    context.savedUser.pendingEmailExpires = new Date(Date.now() + 60_000);
    context.userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(context.savedUser),
    });

    await context.service.cancelEmailChange('user-id');

    expect(context.savedUser.pendingEmail).toBeUndefined();
    expect(context.savedUser.pendingEmailToken).toBeUndefined();
    expect(context.savedUser.pendingEmailExpires).toBeUndefined();
    expect(context.savedUser.save).toHaveBeenCalledWith({
      validateBeforeSave: false,
    });
  });
});
