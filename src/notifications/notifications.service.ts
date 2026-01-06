import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private mailerService: MailerService,
    private configService: ConfigService,
  ) {}

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
      const verificationUrl = `${frontendUrl}/auth/verify-email/${token}`;
      const currentYear = new Date().getFullYear();

      await this.mailerService.sendMail({
        to: email,
        subject: 'Verifica tu email - FinanzApp',
        template: 'email-verification',
        context: {
          verificationUrl,
          token,
          currentYear,
        },
      });

      this.logger.log(`Email de verificación enviado a ${email}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de verificación a ${email}:`,
        error,
      );
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
      const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;
      const currentYear = new Date().getFullYear();

      await this.mailerService.sendMail({
        to: email,
        subject: 'Restablece tu contraseña - FinanzApp',
        template: 'password-reset',
        context: {
          resetUrl,
          token,
          currentYear,
        },
      });

      this.logger.log(`Email de reset de contraseña enviado a ${email}`);
    } catch (error) {
      this.logger.error(`Error al enviar email de reset a ${email}:`, error);
    }
  }

  async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    try {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
      const currentYear = new Date().getFullYear();

      await this.mailerService.sendMail({
        to: email,
        subject: '¡Bienvenido a FinanzApp!',
        template: 'welcome',
        context: {
          firstName,
          frontendUrl,
          currentYear,
        },
      });

      this.logger.log(`Email de bienvenida enviado a ${email}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de bienvenida a ${email}:`,
        error,
      );
    }
  }
}
