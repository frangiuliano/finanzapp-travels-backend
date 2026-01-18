import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { BotService } from './bot.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserDocument } from '../users/user.schema';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from: { id: number; first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data: string;
    message: { chat: { id: number }; message_id: number };
  };
}

@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(private readonly botService: BotService) {}

  @Post('webhook')
  @Public()
  webhook(@Body() update: TelegramUpdate) {
    this.logger.log('=== WEBHOOK RECIBIDO ===');
    this.logger.log(`Update completo: ${JSON.stringify(update)}`);
    this.logger.log(
      `Tipo de update: ${update.message ? 'message' : update.callback_query ? 'callback_query' : 'unknown'}`,
    );

    setImmediate(() => {
      this.botService.handleUpdate(update).catch((error) => {
        this.logger.error('❌ Error procesando update en background:', error);
      });
    });

    return { ok: true };
  }

  @Post('generate-link-token')
  @UseGuards(JwtAuthGuard)
  async generateLinkToken(@GetUser() user: UserDocument) {
    const token = await this.botService.generateLinkToken(user._id.toString());
    return {
      token,
      message: 'Token generado. Úsalo con /start <token> en Telegram.',
    };
  }
}
