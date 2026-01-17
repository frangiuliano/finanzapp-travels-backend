import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramClientService implements OnModuleInit {
  private readonly logger = new Logger(TelegramClientService.name);
  private readonly botToken: string | undefined;
  private readonly telegramApiUrl: string;

  constructor(private configService: ConfigService) {
    this.botToken = configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN no está configurado');
      this.telegramApiUrl = '';
    } else {
      this.telegramApiUrl = `https://api.telegram.org/bot${this.botToken}`;
    }
  }

  async onModuleInit() {
    await this.configureWebhook();
  }

  async configureWebhook(): Promise<void> {
    if (!this.botToken) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN no configurado, no se puede configurar webhook',
      );
      return;
    }

    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) {
      this.logger.warn(
        'No se pudo determinar la URL del webhook. Configúrala manualmente o define WEBHOOK_URL',
      );
      return;
    }

    try {
      const response = await fetch(`${this.telegramApiUrl}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        description?: string;
      };

      if (data.ok) {
        this.logger.log(`✅ Webhook configurado: ${webhookUrl}`);
      } else {
        this.logger.error(`❌ Error configurando webhook: ${data.description}`);
      }
    } catch (error) {
      this.logger.error('Error configurando webhook:', error);
    }
  }

  private getWebhookUrl(): string | null {
    if (process.env.WEBHOOK_URL) {
      return process.env.WEBHOOK_URL;
    }

    if (process.env.NODE_ENV === 'production') {
      return 'https://finanzapp-travels-backend.fly.dev/api/bot/webhook';
    }

    return null;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    if (!this.botToken) {
      this.logger.warn('Bot token no configurado, no se puede enviar mensaje');
      return;
    }

    try {
      const response = await fetch(`${this.telegramApiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as Record<string, unknown>;
        this.logger.error('Error enviando mensaje a Telegram:', error);
      }
    } catch (error) {
      this.logger.error('Error en sendMessage:', error);
    }
  }

  async sendMessageWithButtons(
    chatId: number,
    text: string,
    buttons: Array<{ text: string; callback_data: string }>,
  ): Promise<void> {
    if (!this.botToken) return;

    try {
      const MAX_COLUMNS = 2;
      const keyboard: Array<Array<{ text: string; callback_data: string }>> =
        [];

      for (let i = 0; i < buttons.length; i += MAX_COLUMNS) {
        keyboard.push(buttons.slice(i, i + MAX_COLUMNS));
      }

      const response = await fetch(`${this.telegramApiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: keyboard,
          },
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as Record<string, unknown>;
        this.logger.error('Error enviando mensaje con botones:', error);
      }
    } catch (error) {
      this.logger.error('Error en sendMessageWithButtons:', error);
    }
  }

  async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    if (!this.botToken) return;

    try {
      await fetch(`${this.telegramApiUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: queryId,
          text,
        }),
      });
    } catch (error) {
      this.logger.error('Error en answerCallbackQuery:', error);
    }
  }
}
