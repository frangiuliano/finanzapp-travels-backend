import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserPreferencesDto } from '../users/dto/update-user-preferences.dto';
import { UserPreferencesService } from '../users/user-preferences.service';
import {
  JwtPayload,
  JwtSignPayload,
  AuthResponse,
  RegisterResponse,
} from './interfaces/jwt-payload.interface';
import { hashToken } from '../common/utils/token-hash.util';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
    private userPreferencesService: UserPreferencesService,
  ) {}

  private async generateUsernameForUser(user: UserDocument): Promise<string> {
    if (user.username) {
      return user.username;
    }

    const baseUsername = user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    if (!baseUsername || baseUsername.length < 3) {
      const fallbackBase = 'user';
      let generatedUsername = fallbackBase;
      let counter = 1;

      while (
        await this.userModel
          .findOne({
            username: generatedUsername.toLowerCase(),
            _id: { $ne: user._id },
          })
          .exec()
      ) {
        generatedUsername = `${fallbackBase}${counter}`;
        counter++;
      }
      return generatedUsername.toLowerCase();
    }

    let generatedUsername = baseUsername;
    let counter = 1;

    while (
      await this.userModel
        .findOne({
          username: generatedUsername.toLowerCase(),
          _id: { $ne: user._id },
        })
        .exec()
    ) {
      generatedUsername = `${baseUsername}${counter}`;
      counter++;
    }

    return generatedUsername.toLowerCase();
  }

  async register(registerDto: RegisterDto): Promise<RegisterResponse> {
    const { email, username, password, firstName, lastName } = registerDto;

    const existingUserByEmail = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (existingUserByEmail) {
      throw new ConflictException('El email ya está registrado');
    }

    const existingUserByUsername = await this.userModel
      .findOne({ username: username.toLowerCase() })
      .exec();
    if (existingUserByUsername) {
      throw new ConflictException('El nombre de usuario ya está en uso');
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    const user = new this.userModel({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      password,
      firstName,
      lastName,
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerified: false,
    });

    await user.save();

    await this.notificationsService.sendVerificationEmail(
      user.email,
      emailVerificationToken,
    );

    return {
      message:
        'Cuenta creada. Revisa tu email para verificarla antes de iniciar sesión.',
      email: user.email,
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { emailOrUsername, password } = loginDto;

    const emailOrUsernameLower = emailOrUsername.toLowerCase();

    const user = await this.userModel
      .findOne({
        $or: [
          { email: emailOrUsernameLower },
          { username: emailOrUsernameLower },
        ],
      })
      .select('+password')
      .exec();

    if (!user || !(await user.comparePassword(password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Tu cuenta ha sido desactivada');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Debes verificar tu email antes de iniciar sesión',
      );
    }

    if (!user.username) {
      user.username = await this.generateUsernameForUser(user);
    }

    user.lastLogin = new Date();
    await user.save();

    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.userModel
        .findById(payload.sub)
        .select('+refreshTokens')
        .exec();

      if (!user) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      if (!user.isActive) {
        throw new UnauthorizedException('Tu cuenta ha sido desactivada');
      }

      if (!user.emailVerified) {
        throw new UnauthorizedException(
          'Debes verificar tu email antes de continuar',
        );
      }

      const tokenHash = hashToken(refreshToken);
      const tokenInList = user.refreshTokens?.includes(tokenHash);

      if (!tokenInList) {
        throw new UnauthorizedException('Refresh token inválido');
      }

      const tokens = await this.generateTokens(user, {
        revokeTokenHash: tokenHash,
      });

      return {
        ...tokens,
        user: this.sanitizeUser(user),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (error && typeof error === 'object' && 'name' in error) {
        const errorWithName = error as { name: string; message?: string };
        this.logger.warn(
          'Refresh JWT error: ' +
            errorWithName.name +
            ' - ' +
            (errorWithName.message ?? ''),
        );
        if (
          errorWithName.name === 'TokenExpiredError' ||
          errorWithName.name === 'JsonWebTokenError'
        ) {
          throw new UnauthorizedException('Refresh token inválido o expirado');
        }
      }

      this.logger.error('Refresh unexpected error', error);
      throw new UnauthorizedException('Error al refrescar el token');
    }
  }

  private async generateTokens(
    user: UserDocument,
    options?: { revokeTokenHash?: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtSignPayload = {
      sub: user._id.toString(),
      email: user.email,
      authVersion: user.authVersion ?? 0,
    };

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    const jwtRefreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET');

    if (!jwtSecret || !jwtRefreshSecret) {
      throw new Error('JWT_SECRET o JWT_REFRESH_SECRET no están configurados');
    }

    const accessTokenExpiresIn = this.configService.get<string>(
      'JWT_EXPIRES_IN',
      '1h',
    );
    const refreshTokenExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '30d',
    );

    const accessTokenOptions = {
      secret: jwtSecret,
      expiresIn: accessTokenExpiresIn,
    } as JwtSignOptions;

    const refreshTokenOptions = {
      secret: jwtRefreshSecret,
      expiresIn: refreshTokenExpiresIn,
    } as JwtSignOptions;

    const accessToken = this.jwtService.sign(payload, accessTokenOptions);

    const refreshToken = this.jwtService.sign(payload, refreshTokenOptions);

    if (!user.refreshTokens) {
      user.refreshTokens = [];
    }

    if (options?.revokeTokenHash) {
      user.refreshTokens = user.refreshTokens.filter(
        (storedToken) => storedToken !== options.revokeTokenHash,
      );
    }

    user.refreshTokens.push(hashToken(refreshToken));

    if (user.refreshTokens.length > 10) {
      user.refreshTokens = user.refreshTokens.slice(-10);
    }

    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();

    if (!user) {
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1);

    user.passwordResetToken = hashToken(resetToken);
    user.passwordResetExpires = resetExpires;
    await user.save({ validateBeforeSave: false });

    await this.notificationsService.sendPasswordResetEmail(
      user.email,
      resetToken,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.userModel
      .findOne({
        passwordResetToken: hashToken(token),
        passwordResetExpires: { $gt: new Date() },
      })
      .exec();

    if (!user) {
      throw new BadRequestException('Token inválido o expirado');
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshTokens = [];
    user.authVersion = (user.authVersion ?? 0) + 1;
    await user.save();
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.userModel
      .findOne({ emailVerificationToken: hashToken(token) })
      .exec();

    if (!user) {
      throw new BadRequestException('Token de verificación inválido');
    }

    if (user.emailVerified) {
      return;
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    await this.notificationsService.sendWelcomeEmail(
      user.email,
      user.firstName,
    );
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .exec();

    // Keep the endpoint non-enumerable: missing and already verified accounts
    // intentionally produce the same successful response as pending accounts.
    if (!user || user.emailVerified || !user.isActive) return;

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = hashToken(emailVerificationToken);
    await user.save({ validateBeforeSave: false });

    await this.notificationsService.sendVerificationEmail(
      user.email,
      emailVerificationToken,
    );
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+refreshTokens')
      .exec();

    if (user && user.refreshTokens) {
      user.refreshTokens = user.refreshTokens.filter(
        (storedToken) => storedToken !== hashToken(refreshToken),
      );
      await user.save({ validateBeforeSave: false });
    }
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<{
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
    pendingEmail?: string;
    lastLogin?: Date;
  }> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    let pendingEmailToken: string | undefined;
    const previousEmail = user.email;
    const normalizedRequestedEmail = updateProfileDto.email
      ?.toLowerCase()
      .trim();
    if (normalizedRequestedEmail && normalizedRequestedEmail !== user.email) {
      const normalizedEmail = normalizedRequestedEmail;
      const existingUserByEmail = await this.userModel
        .findOne({
          email: normalizedEmail,
          _id: { $ne: userId },
        })
        .exec();
      if (existingUserByEmail) {
        throw new ConflictException('El email ya está en uso');
      }
      pendingEmailToken = crypto.randomBytes(32).toString('hex');
      user.pendingEmail = normalizedEmail;
      user.pendingEmailToken = hashToken(pendingEmailToken);
      user.pendingEmailExpires = new Date(Date.now() + 60 * 60 * 1000);
    }

    if (
      updateProfileDto.username &&
      updateProfileDto.username.toLowerCase() !== user.username
    ) {
      const existingUserByUsername = await this.userModel
        .findOne({
          username: updateProfileDto.username.toLowerCase(),
          _id: { $ne: userId },
        })
        .exec();
      if (existingUserByUsername) {
        throw new ConflictException('El nombre de usuario ya está en uso');
      }
      user.username = updateProfileDto.username.toLowerCase();
    }

    if (!user.username) {
      user.username = await this.generateUsernameForUser(user);
    }

    user.firstName = updateProfileDto.firstName;
    user.lastName = updateProfileDto.lastName;
    await user.save();

    if (pendingEmailToken && user.pendingEmail) {
      await this.notificationsService.sendEmailChangeConfirmation(
        user.pendingEmail,
        pendingEmailToken,
      );
      await this.notificationsService.sendEmailChangeRequestedNotice(
        previousEmail,
        user.pendingEmail,
      );
    }

    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      pendingEmail: user.pendingEmail,
      lastLogin: user.lastLogin,
    };
  }

  async confirmEmailChange(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const user = await this.userModel
      .findOne({
        pendingEmailToken: tokenHash,
        pendingEmailExpires: { $gt: new Date() },
      })
      .select('+pendingEmailToken +pendingEmailExpires +refreshTokens')
      .exec();

    if (!user?.pendingEmail) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const pendingEmail = user.pendingEmail;
    const existingUser = await this.userModel
      .findOne({ email: pendingEmail, _id: { $ne: user._id } })
      .exec();
    if (existingUser) {
      throw new ConflictException('El email ya está en uso');
    }

    user.email = pendingEmail;
    user.pendingEmail = undefined;
    user.pendingEmailToken = undefined;
    user.pendingEmailExpires = undefined;
    user.refreshTokens = [];
    user.authVersion = (user.authVersion ?? 0) + 1;

    try {
      await user.save();
    } catch (error) {
      const errorCode = (error as { code?: unknown } | null)?.code;
      if (typeof errorCode === 'number' && errorCode === 11000) {
        throw new ConflictException('El email ya está en uso');
      }
      throw error;
    }
  }

  async cancelEmailChange(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    user.pendingEmail = undefined;
    user.pendingEmailToken = undefined;
    user.pendingEmailExpires = undefined;
    await user.save({ validateBeforeSave: false });
  }

  async getUserProfile(userId: string): Promise<{
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
    pendingEmail?: string;
    lastLogin?: Date;
    activeBoardId: string | null;
  }> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (!user.username) {
      user.username = await this.generateUsernameForUser(user);
      await user.save();
    }

    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      pendingEmail: user.pendingEmail,
      lastLogin: user.lastLogin,
      activeBoardId: user.activeBoardId?.toString() ?? null,
    };
  }

  async updatePreferences(
    userId: string,
    dto: UpdateUserPreferencesDto,
  ): Promise<{ activeBoardId: string | null }> {
    return this.userPreferencesService.updatePreferences(
      userId,
      dto.activeBoardId,
    );
  }

  private sanitizeUser(user: UserDocument) {
    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username || '',
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
    };
  }
}
