import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from '../users/user.schema';
import {
  BotUpdate,
  BotUpdateDocument,
  ConversationState,
} from './bot-update.schema';
import {
  TelegramLinkToken,
  TelegramLinkTokenDocument,
} from './telegram-link-token.schema';
import { MessageParserService } from './parsers/message-parser.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TripsService } from '../trips/trips.service';
import { ParticipantsService } from '../participants/participants.service';
import { BudgetsService } from '../budgets/budgets.service';
import * as crypto from 'crypto';
import { CreateExpenseDto } from '../expenses/dto/create-expense.dto';
import { ExpenseStatus, SplitType } from '../expenses/expense.schema';
import { ExpenseSplitDto } from '../expenses/dto/expense-split.dto';

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

interface PopulatedUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email?: string;
}

interface PopulatedParticipant {
  _id: Types.ObjectId;
  guestName?: string;
  guestEmail?: string;
  userId?: PopulatedUser | Types.ObjectId;
}

interface PopulatedBudget {
  _id: Types.ObjectId;
  name: string;
  tripId: Types.ObjectId;
  amount: number;
  currency: string;
  spent: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private readonly botToken: string | undefined;
  private readonly telegramApiUrl: string;
  private readonly configService: ConfigService;

  constructor(
    configService: ConfigService,
    @InjectModel(BotUpdate.name)
    private botUpdateModel: Model<BotUpdateDocument>,
    @InjectModel(TelegramLinkToken.name)
    private linkTokenModel: Model<TelegramLinkTokenDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private messageParser: MessageParserService,
    private expensesService: ExpensesService,
    private tripsService: TripsService,
    private participantsService: ParticipantsService,
    private budgetsService: BudgetsService,
  ) {
    this.configService = configService;
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

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    this.logger.log('=== handleUpdate llamado ===');
    this.logger.log(`Update tiene message: ${!!update.message}`);
    this.logger.log(`Update tiene callback_query: ${!!update.callback_query}`);
    try {
      if (update.message) {
        this.logger.log('Procesando mensaje...');
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        this.logger.log('Procesando callback_query...');
        await this.handleCallbackQuery(update.callback_query);
      } else {
        this.logger.warn('Update no tiene message ni callback_query');
      }
    } catch (error) {
      this.logger.error('Error procesando actualización:', error);
    }
  }

  private async handleMessage(
    message: TelegramUpdate['message'],
  ): Promise<void> {
    this.logger.log('=== handleMessage llamado ===');
    this.logger.log(`Message text: ${message?.text}`);
    this.logger.log(`Message chat: ${!!message?.chat}`);

    if (!message?.text || !message?.chat) {
      this.logger.warn('Message no tiene text o chat, retornando');
      return;
    }

    const telegramUserId = message.from.id;
    const text = message.text.trim();
    this.logger.log(`Telegram User ID: ${telegramUserId}`);
    this.logger.log(`Text: ${text}`);

    if (text.startsWith('/start')) {
      this.logger.log('Es comando /start');
      await this.handleStartCommand(telegramUserId, text);
      return;
    }

    this.logger.log('Obteniendo botUpdate...');
    const botUpdate = await this.getOrCreateBotUpdate(telegramUserId);
    this.logger.log(
      `botUpdate.userId: ${botUpdate.userId?.toString() ?? 'undefined'}`,
    );

    if (!botUpdate.userId) {
      this.logger.log('Usuario no vinculado, enviando mensaje...');
      await this.sendMessage(
        telegramUserId,
        '⚠️ Primero debes vincular tu cuenta. Ve a la web y genera un token de vinculación, luego usa /start <token>',
      );
      this.logger.log('Mensaje enviado');
      return;
    }

    this.logger.log('Usuario vinculado, manejando estado de conversación...');
    await this.handleConversationState(botUpdate, text, telegramUserId);
    this.logger.log('handleConversationState completado');
  }

  private async handleStartCommand(
    telegramUserId: number,
    command: string,
  ): Promise<void> {
    const parts = command.split(' ');

    if (parts.length === 1) {
      await this.sendMessage(
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

    const token = parts[1];
    await this.linkUserWithToken(telegramUserId, token);
  }

  private async linkUserWithToken(
    telegramUserId: number,
    token: string,
  ): Promise<void> {
    const linkToken = await this.linkTokenModel.findOne({ token }).exec();

    if (!linkToken) {
      await this.sendMessage(telegramUserId, '❌ Token inválido o expirado.');
      return;
    }

    if (linkToken.expiresAt < new Date()) {
      await this.sendMessage(
        telegramUserId,
        '❌ El token ha expirado. Genera uno nuevo en la web.',
      );
      await linkToken.deleteOne();
      return;
    }

    const user = await this.userModel.findById(linkToken.userId).exec();
    if (!user) {
      await this.sendMessage(telegramUserId, '❌ Usuario no encontrado.');
      return;
    }

    user.telegramUserId = telegramUserId;
    await user.save();

    const botUpdate = await this.getOrCreateBotUpdate(telegramUserId);
    botUpdate.userId = user._id;
    await botUpdate.save();

    await linkToken.deleteOne();

    await this.sendMessage(
      telegramUserId,
      '✅ ¡Cuenta vinculada exitosamente!\n\n' +
        'Ahora puedes cargar gastos enviándome mensajes informales.\n' +
        'Ejemplo: "Cena 120 usd compartido"',
    );
  }

  private async handleConversationState(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    this.logger.log(`=== handleConversationState ===`);
    this.logger.log(`Estado actual: ${botUpdate.state}`);

    if (botUpdate.state !== ConversationState.IDLE && /\d/.test(text)) {
      this.logger.log(
        'Mensaje parece ser nuevo gasto, reseteando estado a IDLE...',
      );
      botUpdate.state = ConversationState.IDLE;
      botUpdate.pendingExpense = undefined;
      await botUpdate.save();
    }

    switch (botUpdate.state) {
      case ConversationState.IDLE:
        this.logger.log('Estado IDLE, llamando handleNewExpenseMessage...');
        await this.handleNewExpenseMessage(botUpdate, text, telegramUserId);
        this.logger.log('handleNewExpenseMessage completado');
        break;
      case ConversationState.ASKING_TRIP:
        this.logger.log('Estado ASKING_TRIP, llamando handleTripSelection...');
        await this.handleTripSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_BUCKET:
        this.logger.log(
          'Estado ASKING_BUCKET, llamando handleBucketSelection...',
        );
        await this.handleBucketSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_PAYER:
        this.logger.log(
          'Estado ASKING_PAYER, llamando handlePayerSelection...',
        );
        await this.handlePayerSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_SPLIT:
        this.logger.log(
          'Estado ASKING_SPLIT, llamando handleSplitSelection...',
        );
        await this.handleSplitSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.CONFIRMING:
        this.logger.log('Estado CONFIRMING, enviando mensaje...');
        await this.sendMessage(
          telegramUserId,
          '⏳ Espera la confirmación del botón. Si quieres cancelar, usa el botón ❌ Cancelar.',
        );
        break;
      default:
        this.logger.warn(`Estado desconocido: ${botUpdate.state}`);
    }
  }

  private async handleNewExpenseMessage(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    this.logger.log('=== handleNewExpenseMessage llamado ===');

    if (!botUpdate.userId) {
      await this.sendMessage(
        telegramUserId,
        '⚠️ Error: Usuario no vinculado. Usa /start <token> para vincular tu cuenta.',
      );
      return;
    }

    const trips = await this.tripsService.findAll(botUpdate.userId.toString());

    if (trips.length === 0) {
      await this.sendMessage(
        telegramUserId,
        '⚠️ No tienes viajes activos. Crea uno desde la web primero.',
      );
      return;
    }

    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const parseContext = {
      tripName: 'Temp',
      participants: [],
      budgets: [],
      userName,
    };

    const parsed = await this.messageParser.parse(text, parseContext);

    this.logger.log(`Parsed expense: ${JSON.stringify(parsed)}`);

    if (!parsed.amount) {
      await this.sendMessage(
        telegramUserId,
        '⚠️ No pude detectar el monto. Por favor, incluye un número.\n' +
          'Ejemplo: "Cena 120 usd"',
      );
      return;
    }

    let merchantName: string | undefined;
    const merchantMatch = text.match(
      /\ben\s+(?:el\s+|la\s+|los\s+|las\s+)?([a-zA-ZáéíóúñÁÉÍÓÚÑ]+(?:\s+[a-zA-ZáéíóúñÁÉÍÓÚÑ]+){0,1})(?:\s+(?:comprando|compré|comprado|pagando|pagué|pagado|comiendo|comí|tomando|tomé|haciendo|hice|viendo|vi|\d|\b(?:usd|ars|eur|dolar|peso|euro)\b))/i,
    );
    if (merchantMatch) {
      merchantName = merchantMatch[1].trim();

      const articles = /^(el|la|los|las)\s+/i;
      merchantName = merchantName.replace(articles, '');

      if (merchantName) {
        merchantName = merchantName
          .split(' ')
          .map(
            (word) =>
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join(' ');
        this.logger.log(`Extracted merchantName: ${merchantName}`);
      } else {
        merchantName = undefined;
      }
    }

    botUpdate.pendingExpense = {
      amount: parsed.amount,
      currency: parsed.currency || 'USD',
      description: parsed.description || text,
      merchantName,
      isDivisible: parsed.isDivisible || false,
    };

    if (trips.length === 1) {
      const firstTrip = trips[0] as unknown as {
        _id: Types.ObjectId;
      } & Record<string, unknown>;
      const tripId = firstTrip._id.toString();
      botUpdate.currentTripId = new Types.ObjectId(tripId);
      await botUpdate.save();

      await this.continueWithTrip(botUpdate, telegramUserId, tripId);
      return;
    }

    botUpdate.state = ConversationState.ASKING_TRIP;
    await botUpdate.save();
    await this.askForTrip(
      botUpdate,
      telegramUserId,
      trips as unknown as Array<
        { _id: Types.ObjectId; name?: string } & Record<string, unknown>
      >,
    );
  }

  private async askForTrip(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    trips: Array<
      { _id: Types.ObjectId; name?: string } & Record<string, unknown>
    >,
  ): Promise<void> {
    const buttons = trips.slice(0, 10).map((trip) => ({
      text: trip.name || 'Viaje sin nombre',
      callback_data: `trip:${trip._id.toString()}`,
    }));

    await this.sendMessageWithButtons(
      telegramUserId,
      '✈️ ¿Para qué viaje es este gasto?',
      buttons,
    );
  }

  private async askForBucket(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    budgets: PopulatedBudget[],
  ): Promise<void> {
    const buttons = budgets.slice(0, 10).map((budget) => ({
      text: budget.name,
      callback_data: `bucket:${budget._id.toString()}`,
    }));

    buttons.push({ text: '❌ Sin presupuesto', callback_data: 'bucket:none' });

    await this.sendMessageWithButtons(
      telegramUserId,
      '📂 ¿A qué bucket corresponde este gasto?',
      buttons,
    );
  }

  private async handleTripSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const trips = await this.tripsService.findAll(botUpdate.userId!.toString());
    const typedTrips = trips as unknown as Array<
      {
        _id: Types.ObjectId;
        name?: string;
      } & Record<string, unknown>
    >;

    const matchedTrip = typedTrips.find((t) =>
      t.name?.toLowerCase().includes(text.toLowerCase()),
    );

    if (matchedTrip) {
      const tripId = matchedTrip._id.toString();
      botUpdate.currentTripId = new Types.ObjectId(tripId);
      await botUpdate.save();
      await this.continueWithTrip(botUpdate, telegramUserId, tripId);
    } else {
      await this.sendMessage(
        telegramUserId,
        '⚠️ No encontré ese viaje. Por favor, selecciona uno de los botones o escribe el nombre exacto.',
      );
    }
  }

  private async continueWithTrip(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    tripId: string,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const budgetsResult: unknown = await this.budgetsService.findAll(
      tripId,
      updatedBotUpdate.userId!.toString(),
    );
    const budgets = budgetsResult as PopulatedBudget[];

    const parsed = updatedBotUpdate.pendingExpense;
    if (!parsed) return;

    if (budgets.length > 0 && !parsed.budgetId) {
      updatedBotUpdate.state = ConversationState.ASKING_BUCKET;
      await updatedBotUpdate.save();
      await this.askForBucket(updatedBotUpdate, telegramUserId, budgets);
      return;
    }

    let budgetId: string | undefined;
    if (parsed.budgetId) {
      budgetId = parsed.budgetId;
      updatedBotUpdate.pendingExpense.budgetId = budgetId;
    }

    if (budgets.length === 0) {
      updatedBotUpdate.state = ConversationState.ASKING_PAYER;
      await updatedBotUpdate.save();
      await this.askForPayer(updatedBotUpdate, telegramUserId);
      return;
    }

    if (parsed.budgetId && budgetId) {
      updatedBotUpdate.state = ConversationState.ASKING_PAYER;
      await updatedBotUpdate.save();
      await this.askForPayer(updatedBotUpdate, telegramUserId);
      return;
    }
  }

  private async handleBucketSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const tripId = botUpdate.currentTripId!.toString();
    const budgetsResult: unknown = await this.budgetsService.findAll(
      tripId,
      botUpdate.userId!.toString(),
    );
    const budgets = budgetsResult as PopulatedBudget[];
    const matchedBudget = budgets.find((b) =>
      b.name.toLowerCase().includes(text.toLowerCase()),
    );

    if (matchedBudget) {
      const updatedBotUpdate = await this.botUpdateModel
        .findById(botUpdate._id)
        .exec();
      if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
        return;
      }

      updatedBotUpdate.pendingExpense.budgetId = matchedBudget._id.toString();
      updatedBotUpdate.markModified('pendingExpense');

      if (!updatedBotUpdate.pendingExpense.paidByParticipantId) {
        updatedBotUpdate.state = ConversationState.ASKING_PAYER;
        await updatedBotUpdate.save();
        await this.askForPayer(updatedBotUpdate, telegramUserId);
        return;
      }

      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
    } else {
      await this.sendMessage(
        telegramUserId,
        '⚠️ No encontré ese bucket. Por favor, selecciona uno de los botones o escribe el nombre exacto.',
      );
    }
  }

  private async askForPayer(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const tripId = botUpdate.currentTripId!.toString();
    const participants = await this.participantsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );

    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const MAX_SHOWN = 3;
    const showAllButton = typedParticipants.length > MAX_SHOWN;

    const buttons = [{ text: '👤 Yo pagué', callback_data: 'payer:me' }];

    const participantsToShow = showAllButton
      ? typedParticipants.slice(0, MAX_SHOWN)
      : typedParticipants;

    participantsToShow.forEach((p) => {
      const name =
        p.guestName ||
        (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
          ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
          : 'Participante');
      buttons.push({
        text: `👤 ${name}`,
        callback_data: `payer:participant:${p._id.toString()}`,
      });
    });

    if (showAllButton) {
      buttons.push({
        text: '➕ Ver más participantes',
        callback_data: 'payer:show_more',
      });
    }

    await this.sendMessageWithButtons(
      telegramUserId,
      '💳 ¿Quién pagó este gasto?',
      buttons,
    );
  }

  private async handlePayerSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    if (
      text.toLowerCase().includes('yo') ||
      text.toLowerCase().includes('mí')
    ) {
      const tripId = botUpdate.currentTripId!.toString();
      const userParticipant =
        (await this.participantsService.findUserParticipant(
          tripId,
          botUpdate.userId!.toString(),
        )) as unknown as PopulatedParticipant | null;
      if (userParticipant) {
        botUpdate.pendingExpense = botUpdate.pendingExpense || {};
        botUpdate.pendingExpense.paidByParticipantId =
          userParticipant._id.toString();
      }
      botUpdate.state = ConversationState.CONFIRMING;
      await this.showConfirmation(botUpdate, telegramUserId);
    }
  }

  private async handleSplitSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    botUpdate.state = ConversationState.CONFIRMING;
    await this.showConfirmation(botUpdate, telegramUserId);
  }

  private async handleCallbackQuery(
    callback: TelegramUpdate['callback_query'],
  ): Promise<void> {
    if (!callback) return;

    const telegramUserId = callback.from.id;
    const data = callback.data;
    const callbackQueryId = callback.id;
    let botUpdate = await this.getOrCreateBotUpdate(telegramUserId);

    if (!botUpdate.userId) {
      await this.answerCallbackQuery(
        callbackQueryId,
        '⚠️ Debes vincular tu cuenta primero.',
      );
      return;
    }

    const reloadedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (reloadedBotUpdate) {
      botUpdate = reloadedBotUpdate;
    }

    try {
      if (data.startsWith('trip:')) {
        const tripId = data.replace('trip:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        updatedBotUpdate.currentTripId = new Types.ObjectId(tripId);
        await updatedBotUpdate.save();
        await this.continueWithTrip(updatedBotUpdate, telegramUserId, tripId);
        await this.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('bucket:')) {
        const bucketId = data.replace('bucket:', '');
        this.logger.log(`Callback bucket recibido - bucketId raw: ${bucketId}`);

        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        this.logger.log(
          `PendingExpense antes de actualizar: ${JSON.stringify(updatedBotUpdate.pendingExpense)}`,
        );

        updatedBotUpdate.pendingExpense.budgetId =
          bucketId === 'none' ? undefined : bucketId;
        updatedBotUpdate.markModified('pendingExpense');
        this.logger.log(
          `Bucket seleccionado - budgetId: ${updatedBotUpdate.pendingExpense.budgetId}`,
        );
        this.logger.log(
          `PendingExpense después de actualizar: ${JSON.stringify(updatedBotUpdate.pendingExpense)}`,
        );

        if (!updatedBotUpdate.pendingExpense.paidByParticipantId) {
          updatedBotUpdate.state = ConversationState.ASKING_PAYER;
          await updatedBotUpdate.save();
          await this.askForPayer(updatedBotUpdate, telegramUserId);
          await this.answerCallbackQuery(callbackQueryId);
          return;
        }

        updatedBotUpdate.state = ConversationState.CONFIRMING;
        this.logger.log(
          `Guardando botUpdate con budgetId: ${updatedBotUpdate.pendingExpense.budgetId}`,
        );
        await updatedBotUpdate.save();
        this.logger.log(`botUpdate guardado. Verificando después de save...`);
        const savedBotUpdate = await this.botUpdateModel
          .findById(updatedBotUpdate._id)
          .exec();
        this.logger.log(
          `botUpdate recargado - budgetId: ${savedBotUpdate?.pendingExpense?.budgetId}`,
        );
        await this.showConfirmation(
          savedBotUpdate || updatedBotUpdate,
          telegramUserId,
        );
        await this.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('payer:')) {
        await this.handlePayerCallback(
          botUpdate,
          data,
          telegramUserId,
          callbackQueryId,
        );
      } else if (data.startsWith('confirm:')) {
        if (data === 'confirm:yes') {
          await this.confirmExpense(botUpdate, telegramUserId);
        } else {
          await this.cancelExpense(botUpdate, telegramUserId);
        }
        await this.answerCallbackQuery(callbackQueryId);
      }
    } catch (error) {
      this.logger.error('Error procesando callback:', error);
      await this.answerCallbackQuery(
        callbackQueryId,
        '❌ Ocurrió un error. Por favor, intenta de nuevo.',
      );
    }
  }

  private async handlePayerCallback(
    botUpdate: BotUpdateDocument,
    data: string,
    telegramUserId: number,
    callbackQueryId: string,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      await this.sendMessage(
        telegramUserId,
        '⚠️ Error: No se encontró el gasto. Por favor, intenta de nuevo.',
      );
      return;
    }

    if (data === 'payer:me') {
      const tripId = updatedBotUpdate.currentTripId!.toString();
      const userParticipant =
        (await this.participantsService.findUserParticipant(
          tripId,
          updatedBotUpdate.userId!.toString(),
        )) as unknown as PopulatedParticipant | null;
      if (userParticipant) {
        updatedBotUpdate.pendingExpense.paidByParticipantId =
          userParticipant._id.toString();
      }
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      await this.answerCallbackQuery(callbackQueryId);
    } else if (data.startsWith('payer:participant:')) {
      const participantId = data.replace('payer:participant:', '');
      updatedBotUpdate.pendingExpense.paidByParticipantId = participantId;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      await this.answerCallbackQuery(callbackQueryId);
    } else if (data === 'payer:show_more') {
      const tripId = updatedBotUpdate.currentTripId!.toString();
      const participants = await this.participantsService.findByTrip(
        tripId,
        updatedBotUpdate.userId!.toString(),
      );

      const typedParticipants =
        participants as unknown as PopulatedParticipant[];
      const remainingParticipants = typedParticipants.slice(3);

      const buttons = remainingParticipants.map((p) => {
        const name =
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante');
        return {
          text: `👤 ${name}`,
          callback_data: `payer:participant:${p._id.toString()}`,
        };
      });

      await this.sendMessageWithButtons(
        telegramUserId,
        '👥 Selecciona quién pagó:',
        buttons,
      );
      await this.answerCallbackQuery(callbackQueryId);
    }
  }

  private async showConfirmation(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const expense = botUpdate.pendingExpense;
    if (!expense) return;

    let payerName = 'No especificado';
    if (expense.paidByParticipantId) {
      const participant = (await this.participantsService.findOne(
        expense.paidByParticipantId,
        botUpdate.currentTripId!.toString(),
        botUpdate.userId!.toString(),
      )) as unknown as PopulatedParticipant;
      payerName =
        participant.guestName ||
        (participant.userId &&
        typeof participant.userId === 'object' &&
        'firstName' in participant.userId
          ? `${participant.userId.firstName} ${participant.userId.lastName}`.trim()
          : 'Participante');
    }

    let budgetName = 'Sin presupuesto';
    this.logger.log(`Expense budgetId: ${expense.budgetId}`);
    if (expense.budgetId && botUpdate.userId) {
      this.logger.log(`Buscando budget con ID: ${expense.budgetId}`);
      const budget = await this.budgetsService.findOne(
        expense.budgetId,
        botUpdate.userId.toString(),
      );
      this.logger.log(`Budget encontrado: ${budget?.name || 'null'}`);
      budgetName = budget?.name || 'Sin presupuesto';
    }

    const merchantLine = expense.merchantName
      ? `🏪 *Comercio:* ${expense.merchantName}\n`
      : '';
    const message =
      '📋 *Resumen del gasto:*\n\n' +
      `💰 *Monto:* ${expense.amount} ${expense.currency || 'USD'}\n` +
      `📝 *Descripción:* ${expense.description || 'Sin descripción'}\n` +
      merchantLine +
      `📂 *Bucket:* ${budgetName}\n` +
      `💳 *Pagó:* ${payerName}\n` +
      `📊 *Tipo:* ${expense.isDivisible ? 'Compartido' : 'Personal'}\n` +
      `✅ *Estado:* Pagado`;

    const buttons = [
      { text: '✅ Confirmar', callback_data: 'confirm:yes' },
      { text: '❌ Cancelar', callback_data: 'confirm:no' },
    ];

    await this.sendMessageWithButtons(telegramUserId, message, buttons);
  }

  private async confirmExpense(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate) {
      await this.sendMessage(
        telegramUserId,
        '❌ Error: No se pudo cargar el gasto.',
      );
      return;
    }

    const expense = updatedBotUpdate.pendingExpense;
    if (!expense || !updatedBotUpdate.currentTripId) {
      await this.sendMessage(
        telegramUserId,
        '❌ Error: No hay gasto para confirmar.',
      );
      return;
    }

    try {
      const createExpenseDto: CreateExpenseDto = {
        tripId: updatedBotUpdate.currentTripId.toString(),
        amount: expense.amount!,
        currency: expense.currency || 'USD',
        description: expense.description || 'Gasto sin descripción',
        merchantName: expense.merchantName,
        budgetId: expense.budgetId,
        paidByParticipantId: expense.paidByParticipantId!,
        status: ExpenseStatus.PAID,
        isDivisible: expense.isDivisible || false,
        splitType: expense.splitType as SplitType | undefined,
        splits: expense.splits as ExpenseSplitDto[] | undefined,
        expenseDate: new Date().toISOString(),
      };

      await this.expensesService.create(
        createExpenseDto,
        updatedBotUpdate.userId!.toString(),
      );

      updatedBotUpdate.state = ConversationState.IDLE;
      updatedBotUpdate.pendingExpense = undefined;
      await updatedBotUpdate.save();

      await this.sendMessage(
        telegramUserId,
        '✅ ¡Gasto guardado exitosamente!\n\n' +
          'Puedes verlo en tu dashboard web.',
      );
    } catch (error) {
      this.logger.error('Error creando gasto:', error);
      await this.sendMessage(
        telegramUserId,
        '❌ Error al guardar el gasto. Por favor, intenta nuevamente.',
      );
    }
  }

  private async cancelExpense(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    botUpdate.state = ConversationState.IDLE;
    botUpdate.pendingExpense = undefined;
    await botUpdate.save();

    await this.sendMessage(telegramUserId, '❌ Gasto cancelado.');
  }

  private async determineActiveTrip(
    botUpdate: BotUpdateDocument,
  ): Promise<string | null> {
    if (botUpdate.currentTripId) {
      try {
        await this.tripsService.findOne(
          botUpdate.currentTripId.toString(),
          botUpdate.userId!.toString(),
        );
        return botUpdate.currentTripId.toString();
      } catch {
        // El viaje ya no es válido, buscar otro
      }
    }

    const trips = await this.tripsService.findAll(botUpdate.userId!.toString());

    if (trips.length === 0) {
      return null;
    }

    if (trips.length === 1) {
      const firstTrip = trips[0] as unknown as {
        _id: Types.ObjectId;
      } & Record<string, unknown>;
      const tripId = firstTrip._id.toString();
      botUpdate.currentTripId = new Types.ObjectId(tripId);
      await botUpdate.save();
      return tripId;
    }

    const mostRecentTrip = trips[0] as unknown as {
      _id: Types.ObjectId;
    } & Record<string, unknown>;
    const tripId = mostRecentTrip._id.toString();
    botUpdate.currentTripId = new Types.ObjectId(tripId);
    await botUpdate.save();
    return tripId;
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
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

  private async sendMessageWithButtons(
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

  private async answerCallbackQuery(
    queryId: string,
    text?: string,
  ): Promise<void> {
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

  private async getOrCreateBotUpdate(
    telegramUserId: number,
  ): Promise<BotUpdateDocument> {
    let botUpdate = await this.botUpdateModel
      .findOne({ telegramUserId })
      .exec();

    if (!botUpdate) {
      botUpdate = new this.botUpdateModel({
        telegramUserId,
        state: ConversationState.IDLE,
      });
      await botUpdate.save();
    }

    return botUpdate;
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
