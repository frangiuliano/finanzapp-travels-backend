import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { NotificationsService } from './notifications.service';
import { BoardType } from '../trips/board.schema';

describe('NotificationsService board invitations', () => {
  const sendMail = jest
    .fn<Promise<void>, [Record<string, unknown>]>()
    .mockResolvedValue(undefined);
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL' ? 'https://app.finanzapp.test' : undefined,
    ),
  };
  const service = new NotificationsService(
    { sendMail } as unknown as MailerService,
    config as unknown as ConfigService,
  );

  beforeEach(() => {
    sendMail.mockClear();
  });

  it.each([
    [BoardType.EVERYDAY, 'tablero cotidiano', false],
    [BoardType.TRAVEL, 'viaje', true],
  ])(
    'uses the correct wording for a %s board',
    async (boardType, boardKind, isTravel) => {
      await service.sendBoardInvitationEmail(
        'persona@example.com',
        'Ada Lovelace',
        'Casa',
        boardType,
        'token-123',
      );

      const mail = sendMail.mock.calls[0]?.[0] as unknown as {
        subject: string;
        template: string;
        context: Record<string, unknown>;
      };
      expect(mail.subject).toBe(
        `Ada Lovelace te invitó a un ${boardKind} - FinanzApp`,
      );
      expect(mail.template).toBe('trip-invitation');
      expect(mail.context).toMatchObject({
        boardName: 'Casa',
        boardKind,
        isTravel,
        invitationUrl: 'https://app.finanzapp.test/boards/invitation/token-123',
      });
    },
  );
});
