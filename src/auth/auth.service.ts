import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthResponse } from './interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, firstName, lastName } = registerDto;

    const existingUser = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    const user = new this.userModel({
      email: email.toLowerCase(),
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
    const { email, password } = loginDto;

    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .exec();

    if (!user || !(await user.comparePassword(password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Tu cuenta ha sido desactivada');
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

      const user = await this.userModel.findById(payload.sub).exec();

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Usuario no encontrado o inactivo');
      }

      if (!user.refreshTokens?.includes(refreshToken)) {
        throw new UnauthorizedException('Refresh token inválido');
      }

      const tokens = await this.generateTokens(user);

      return {
        ...tokens,
        user: this.sanitizeUser(user),
      };
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
  }

  private async generateTokens(
    user: UserDocument,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
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

    // Note: Using 'as any' is necessary due to type incompatibility
    // between ConfigService return type and JwtSignOptions.expiresIn
    const accessToken = this.jwtService.sign(payload, {
      secret: jwtSecret,
      expiresIn: accessTokenExpiresIn as string | number,
    } as any);

    const refreshToken = this.jwtService.sign(payload, {
      secret: jwtRefreshSecret,
      expiresIn: refreshTokenExpiresIn as string | number,
    } as any);

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
      throw new BadRequestException('El email ya ha sido verificado');
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    await this.notificationsService.sendWelcomeEmail(
      user.email,
      user.firstName,
    );
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const user = await this.userModel.findById(userId).exec();

    if (user && user.refreshTokens) {
      user.refreshTokens = user.refreshTokens.filter(
        (token) => token !== refreshToken,
      );
      await user.save({ validateBeforeSave: false });
    }
  }

  private sanitizeUser(user: UserDocument) {
    return {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: user.emailVerified,
    };
  }
}
