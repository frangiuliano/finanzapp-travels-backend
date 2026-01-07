import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { NotificationsService } from './notifications.service';
import { join } from 'path';
import { existsSync } from 'fs';

@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('SMTP_HOST');
        const port = configService.get<number>('SMTP_PORT', 587);
        const user = configService.get<string>('SMTP_USER');
        const pass = configService.get<string>('SMTP_PASS');

        if (!host || !user || !pass) {
          console.warn(
            '⚠️  Advertencia: Las credenciales SMTP no están completamente configuradas. ' +
              'Verifica las variables de entorno: SMTP_HOST, SMTP_USER, SMTP_PASS',
          );
        }

        const isGmail = host?.includes('gmail.com');

        const cleanPass = pass?.replace(/\s/g, '');

        if (isGmail) {
          return {
            transport: {
              service: 'gmail',
              auth: {
                user,
                pass: cleanPass,
              },
            },
            defaults: {
              from: `"${configService.get('APP_NAME', 'FinanzApp')}" <${configService.get('SMTP_FROM') || user}>`,
            },
            template: {
              dir: (() => {
                const distPath = join(__dirname, 'templates');
                if (existsSync(distPath)) {
                  return distPath;
                }
                return join(process.cwd(), 'src', 'notifications', 'templates');
              })(),
              adapter: new HandlebarsAdapter(),
              options: {
                strict: true,
              },
            },
          };
        }

        const secure =
          port === 465 || configService.get<boolean>('SMTP_SECURE', false);

        return {
          transport: {
            host,
            port,
            secure,
            auth: {
              user,
              pass: cleanPass,
            },
          },
          defaults: {
            from: `"${configService.get('APP_NAME', 'FinanzApp')}" <${configService.get('SMTP_FROM') || user}>`,
          },
          template: {
            dir: (() => {
              const distPath = join(__dirname, 'templates');
              if (existsSync(distPath)) {
                return distPath;
              }
              return join(process.cwd(), 'src', 'notifications', 'templates');
            })(),
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
