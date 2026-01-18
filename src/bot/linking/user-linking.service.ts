import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../../users/user.schema';
import {
  TelegramLinkToken,
  TelegramLinkTokenDocument,
} from '../telegram-link-token.schema';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { BotUpdateRepository } from '../repositories/bot-update.repository';
import * as crypto from 'crypto';

@Injectable()
export class UserLinkingService {
  private readonly logger = new Logger(UserLinkingService.name);

  constructor(
    @InjectModel(TelegramLinkToken.name)
    private linkTokenModel: Model<TelegramLinkTokenDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private telegramClient: TelegramClientService,
    private botUpdateRepository: BotUpdateRepository,
  ) {}

  async handleStartCommand(
    telegramUserId: number,
    command: string,
  ): Promise<void> {
    const parts = command.trim().split(/\s+/);

    if (parts.length === 1) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '👋 ¡Hola! Soy el bot de FinanzApp Travels.\n\n' +
          'Para vincular tu cuenta:\n' +
          '1. Inicia sesión en la web\n' +
          '2. Ve a Configuración → Bot de Telegram\n' +
          '3. Copia el token que se genera\n' +
          '4. Envíame: /start <token>\n\n' +
          'Ejemplo: /start abc123xyz',
      );
      return;
    }

    const token = parts[1].trim();
    this.logger.log(
      `Token recibido para usuario ${telegramUserId}: ${token.substring(0, 8)}...`,
    );
    await this.linkUserWithToken(telegramUserId, token);
  }

  private async linkUserWithToken(
    telegramUserId: number,
    token: string,
  ): Promise<void> {
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      this.logger.warn(`Token vacío recibido para usuario ${telegramUserId}`);
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Token inválido o expirado.',
      );
      return;
    }

    this.logger.log(`Buscando token en BD: ${trimmedToken.substring(0, 8)}...`);
    const linkToken = await this.linkTokenModel
      .findOne({ token: trimmedToken })
      .exec();

    if (!linkToken) {
      this.logger.warn(
        `Token no encontrado en BD: ${trimmedToken.substring(0, 8)}...`,
      );
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Token inválido o expirado.',
      );
      return;
    }

    this.logger.log(
      `Token encontrado, expira en: ${linkToken.expiresAt.toISOString()}`,
    );

    if (linkToken.expiresAt < new Date()) {
      this.logger.warn(`Token expirado para usuario ${telegramUserId}`);
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ El token ha expirado. Genera uno nuevo en la web.',
      );
      await linkToken.deleteOne();
      return;
    }

    const user = await this.userModel.findById(linkToken.userId).exec();
    if (!user) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Usuario no encontrado.',
      );
      return;
    }

    user.telegramUserId = telegramUserId;
    await user.save();

    const botUpdate =
      await this.botUpdateRepository.getOrCreateBotUpdate(telegramUserId);
    botUpdate.userId = user._id;
    await botUpdate.save();

    await linkToken.deleteOne();

    await this.telegramClient.sendMessage(
      telegramUserId,
      '✅ ¡Cuenta vinculada exitosamente!\n\n' +
        'Ahora puedes cargar gastos enviándome mensajes informales.\n' +
        'Ejemplo: "Cena 120 usd compartido"',
    );
  }

  async generateLinkToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');

    await this.linkTokenModel.create({
      userId: new Types.ObjectId(userId),
      token,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    return token;
  }
}
