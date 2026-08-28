import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { BoardType } from '../trips/board.schema';
import {
  maskEmail,
  toSafeErrorMessage,
} from '../common/utils/log-redaction.util';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly frontendUrl: string;

  constructor(
    private mailerService: MailerService,
    private configService: ConfigService,
  ) {
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL') || '';
  }

  private getApiPublicBaseUrl(): string {
    const configured = this.configService.get<string>('API_PUBLIC_URL');
    if (configured) {
      return configured.replace(/\/$/, '');
    }

    const webhookUrl = this.configService.get<string>('WEBHOOK_URL') || '';
    if (webhookUrl.includes('/api/')) {
      return webhookUrl.replace(/\/api\/.*$/, '/api');
    }

    return 'https://finanzapp-travels-backend.fly.dev/api';
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    try {
      const verificationUrl = `${this.getApiPublicBaseUrl()}/auth/verify-email/${token}?source=email`;
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

      this.logger.log(`Email de verificación enviado a ${maskEmail(email)}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de verificación a ${maskEmail(email)}`,
        toSafeErrorMessage(error),
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

      this.logger.log(
        `Email de reset de contraseña enviado a ${maskEmail(email)}`,
      );
    } catch (error) {
      this.logger.error(
        `Error al enviar email de reset a ${maskEmail(email)}`,
        toSafeErrorMessage(error),
      );
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

      this.logger.log(`Email de bienvenida enviado a ${maskEmail(email)}`);
    } catch (error) {
      this.logger.error(
        `Error al enviar email de bienvenida a ${maskEmail(email)}`,
        toSafeErrorMessage(error),
      );
    }
  }

  async sendEmailChangeConfirmation(
    email: string,
    token: string,
  ): Promise<void> {
    const confirmationUrl = `${this.frontendUrl}/auth/confirm-email-change?token=${token}`;
    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirma tu nuevo email - FinanzApp',
      template: 'email-change-confirmation',
      context: { confirmationUrl, currentYear: new Date().getFullYear() },
    });
  }

  async sendEmailChangeRequestedNotice(
    oldEmail: string,
    newEmail: string,
  ): Promise<void> {
    await this.mailerService.sendMail({
      to: oldEmail,
      subject: 'Solicitud de cambio de email - FinanzApp',
      template: 'email-change-requested',
      context: { newEmail, currentYear: new Date().getFullYear() },
    });
  }

  async sendBoardInvitationEmail(
    email: string,
    inviterName: string,
    boardName: string,
    boardType: BoardType,
    token: string,
  ): Promise<void> {
    try {
      const invitationUrl = `${this.frontendUrl}/boards/invitation/${token}`;
      const currentYear = new Date().getFullYear();

      // Calcular fecha de expiración (7 días desde ahora)
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 7);
      const formattedExpirationDate = expirationDate.toLocaleDateString(
        'es-ES',
        {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        },
      );

      const isTravel = boardType === BoardType.TRAVEL;
      const boardKind = isTravel ? 'viaje' : 'tablero cotidiano';

      await this.mailerService.sendMail({
        to: email,
        subject: `${inviterName} te invitó a un ${boardKind} - FinanzApp`,
        template: 'trip-invitation',
        context: {
          inviterName,
          boardName,
          boardKind,
          isTravel,
          invitationUrl,
          expirationDate: formattedExpirationDate,
          currentYear,
        },
      });

      this.logger.log(
        `Email de invitación a ${boardKind} enviado a ${maskEmail(email)}`,
      );
    } catch (error) {
      this.logger.error(
        `Error al enviar email de invitación a ${maskEmail(email)}`,
        toSafeErrorMessage(error),
      );
    }
  }
}
