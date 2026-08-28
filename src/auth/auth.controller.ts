import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Param,
  Query,
  Patch,
  Delete,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ConfirmEmailChangeDto } from './dto/confirm-email-change.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserPreferencesDto } from '../users/dto/update-user-preferences.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Public } from './decorators/public.decorator';
import { GetUser } from './decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';
import {
  getLegacyRefreshTokenClearCookieOptions,
  getRefreshTokenClearCookieOptions,
  getRefreshTokenCookieOptions,
} from './refresh-token-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private getFrontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);

    this.clearLegacyRefreshTokenCookie(res);
    res.cookie(
      'refreshToken',
      result.refreshToken,
      getRefreshTokenCookieOptions(this.configService),
    );

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token no encontrado');
    }

    const result = await this.authService.refreshToken(refreshToken);

    this.clearLegacyRefreshTokenCookie(res);
    res.cookie(
      'refreshToken',
      result.refreshToken,
      getRefreshTokenCookieOptions(this.configService),
    );

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    await this.authService.forgotPassword(forgotPasswordDto.email);
    return {
      message:
        'Si el email existe, recibirás instrucciones para resetear tu contraseña',
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    await this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.newPassword,
    );
    return { message: 'Contraseña restablecida exitosamente' };
  }

  @Public()
  @Get('verify-email/:token')
  async verifyEmail(
    @Param('token') token: string,
    @Res() res: Response,
    @Query('source') source?: string,
  ) {
    const frontendUrl = this.getFrontendUrl();

    try {
      await this.authService.verifyEmail(token);
      if (source === 'email') {
        return res.redirect(302, `${frontendUrl}/verify-email?status=success`);
      }
      return res
        .status(HttpStatus.OK)
        .json({ message: 'Email verificado exitosamente' });
    } catch (error) {
      if (source === 'email') {
        return res.redirect(302, `${frontendUrl}/verify-email?status=error`);
      }
      throw error;
    }
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerificationEmail(dto.email);
    return {
      message:
        'Si existe una cuenta pendiente para ese email, recibirás un nuevo enlace de verificación.',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @GetUser() user: UserDocument,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.refreshToken;

    if (refreshToken) {
      await this.authService.logout(user._id.toString(), refreshToken);
    }

    res.clearCookie(
      'refreshToken',
      getRefreshTokenClearCookieOptions(this.configService),
    );
    this.clearLegacyRefreshTokenCookie(res);

    return { message: 'Sesión cerrada exitosamente' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@GetUser() user: UserDocument) {
    return this.authService.getUserProfile(user._id.toString());
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @GetUser() user: UserDocument,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const updatedUser = await this.authService.updateProfile(
      user._id.toString(),
      updateProfileDto,
    );
    return updatedUser;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('confirm-email-change')
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.confirmEmailChange(dto.token);
    res.clearCookie(
      'refreshToken',
      getRefreshTokenClearCookieOptions(this.configService),
    );
    this.clearLegacyRefreshTokenCookie(res);
    return {
      message: 'Email actualizado. Inicia sesión nuevamente.',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('pending-email-change')
  @HttpCode(HttpStatus.OK)
  async cancelEmailChange(@GetUser() user: UserDocument) {
    await this.authService.cancelEmailChange(user._id.toString());
    return { message: 'Solicitud de cambio de email cancelada.' };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('preferences')
  @HttpCode(HttpStatus.OK)
  async updatePreferences(
    @GetUser() user: UserDocument,
    @Body() updatePreferencesDto: UpdateUserPreferencesDto,
  ) {
    return this.authService.updatePreferences(
      user._id.toString(),
      updatePreferencesDto,
    );
  }

  private clearLegacyRefreshTokenCookie(res: Response): void {
    res.clearCookie(
      'refreshToken',
      getLegacyRefreshTokenClearCookieOptions(this.configService),
    );
  }
}
