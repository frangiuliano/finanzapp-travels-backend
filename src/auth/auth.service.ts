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
import {
  JwtPayload,
  JwtSignPayload,
  AuthResponse,
} from './interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
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

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
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
      emailVerificationToken,
      emailVerified: false,
    });

    await user.save();

    const tokens = await this.generateTokens(user);

    await this.notificationsService.sendVerificationEmail(
      user.email,
      emailVerificationToken,
    );

    return {
      ...tokens,
      user: this.sanitizeUser(user),
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
    this.logger.log(
      'Refresh attempt (token length: ' + refreshToken?.length + ')',
    );

    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
      this.logger.log('JWT verified, sub: ' + payload.sub);

      const user = await this.userModel
        .findById(payload.sub)
        .select('+refreshTokens')
        .exec();

      if (!user) {
        this.logger.warn('Refresh failed: user not found, sub: ' + payload.sub);
        throw new UnauthorizedException('Usuario no encontrado');
      }

      if (!user.isActive) {
        this.logger.warn('Refresh failed: user inactive');
        throw new UnauthorizedException('Tu cuenta ha sido desactivada');
      }

      const tokenInList = user.refreshTokens?.includes(refreshToken);
      this.logger.log(
        'refreshTokens count: ' +
          (user.refreshTokens?.length ?? 0) +
          ', token in list: ' +
          tokenInList,
      );

      if (!tokenInList) {
        this.logger.warn('Refresh failed: token not in user.refreshTokens');
        throw new UnauthorizedException('Refresh token inválido');
      }

      const tokens = await this.generateTokens(user);
      this.logger.log('Refresh success for sub: ' + payload.sub);

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
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtSignPayload = {
      sub: user._id.toString(),
      email: user.email,
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
    user.refreshTokens.push(refreshToken);

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

    user.passwordResetToken = resetToken;
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
        passwordResetToken: token,
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
    await user.save();
  }

  async verifyEmail(token: string): Promise<void> {
    const user = await this.userModel
      .findOne({ emailVerificationToken: token })
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

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (user.emailVerified) {
      throw new BadRequestException('El email ya ha sido verificado');
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = emailVerificationToken;
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
        (token) => token !== refreshToken,
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
    lastLogin?: Date;
  }> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (
      updateProfileDto.email &&
      updateProfileDto.email.toLowerCase() !== user.email
    ) {
      const existingUserByEmail = await this.userModel
        .findOne({
          email: updateProfileDto.email.toLowerCase(),
          _id: { $ne: userId },
        })
        .exec();
      if (existingUserByEmail) {
        throw new ConflictException('El email ya está en uso');
      }
      user.email = updateProfileDto.email.toLowerCase();
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

    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
      lastLogin: user.lastLogin,
    };
  }

  async getUserProfile(userId: string): Promise<{
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    emailVerified: boolean;
    lastLogin?: Date;
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
      lastLogin: user.lastLogin,
    };
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
