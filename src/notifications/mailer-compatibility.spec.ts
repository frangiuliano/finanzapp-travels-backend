import { Test } from '@nestjs/testing';
import { MailerModule, MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { mailerDefaults } from './mailer-defaults';

describe('Mailer dependency compatibility', () => {
  it('renders a real invitation and builds its MIME message without sending email', async () => {
    const module = await Test.createTestingModule({
      imports: [
        MailerModule.forRoot({
          transport: { streamTransport: true, buffer: true, newline: 'unix' },
          defaults: mailerDefaults({
            from: 'FinanzApp <notifications@example.com>',
          }),
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
        }),
      ],
    }).compile();

    try {
      const result = (await module.get(MailerService).sendMail({
        to: 'test@example.com',
        subject: 'FinanzApp invitation',
        template: 'trip-invitation',
        context: {
          boardKind: 'tablero cotidiano',
          isTravel: false,
          inviterName: 'Test User',
          boardName: 'Test Board',
          invitationUrl: 'https://example.com/invitation/test',
          expirationDate: '01/10/2026',
          currentYear: 2026,
        },
      })) as { message: Buffer; envelope: { from: string; to: string[] } };

      expect(Buffer.isBuffer(result.message)).toBe(true);
      const message = result.message.toString('utf8');
      expect(message).toContain('Subject: FinanzApp invitation');
      expect(message).toContain('Test Board');
      expect(message).toContain('https://example.com/invitation/test');
      expect(message).not.toContain('{{boardName}}');
      expect(result.envelope).toEqual({
        from: 'notifications@example.com',
        to: ['test@example.com'],
      });
    } finally {
      await module.close();
    }
  });
});
