import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import {
  BotUpdate,
  BotUpdateDocument,
  ConversationState,
} from './bot-update.schema';
import { MessageParserService } from './parsers/message-parser.service';
import { ConversationalService } from './parsers/conversational.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TripsService } from '../trips/trips.service';
import { ParticipantsService } from '../participants/participants.service';
import { BudgetsService } from '../budgets/budgets.service';
import { CardsService } from '../cards/cards.service';
import { CreateExpenseDto } from '../expenses/dto/create-expense.dto';
import {
  ExpenseStatus,
  SplitType,
  PaymentMethod,
} from '../expenses/expense.schema';
import { ExpenseSplitDto } from '../expenses/dto/expense-split.dto';
import { TelegramUpdate } from './types/telegram.types';
import { PopulatedParticipant, PopulatedBudget } from './types/populated.types';
import { TelegramClientService } from './telegram/telegram-client.service';
import { UserLinkingService } from './linking/user-linking.service';
import { BotUpdateRepository } from './repositories/bot-update.repository';
import { getCardId } from './utils/bot-helpers';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    @InjectModel(BotUpdate.name)
    private botUpdateModel: Model<BotUpdateDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private messageParser: MessageParserService,
    private conversationalService: ConversationalService,
    private expensesService: ExpensesService,
    private tripsService: TripsService,
    private participantsService: ParticipantsService,
    private budgetsService: BudgetsService,
    private cardsService: CardsService,
    private telegramClient: TelegramClientService,
    private userLinkingService: UserLinkingService,
    private botUpdateRepository: BotUpdateRepository,
  ) {}

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
      await this.userLinkingService.handleStartCommand(telegramUserId, text);
      return;
    }

    this.logger.log('Obteniendo botUpdate...');
    const botUpdate =
      await this.botUpdateRepository.getOrCreateBotUpdate(telegramUserId);
    this.logger.log(
      `botUpdate.userId: ${botUpdate.userId?.toString() ?? 'undefined'}`,
    );

    if (!botUpdate.userId) {
      this.logger.log('Usuario no vinculado, enviando mensaje...');
      await this.telegramClient.sendMessage(
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
      case ConversationState.ASKING_MERCHANT:
        this.logger.log(
          'Estado ASKING_MERCHANT, llamando handleMerchantSelection...',
        );
        await this.handleMerchantSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_PAYMENT_METHOD:
        this.logger.log(
          'Estado ASKING_PAYMENT_METHOD, llamando handlePaymentMethodSelection...',
        );
        await this.handlePaymentMethodSelection(
          botUpdate,
          text,
          telegramUserId,
        );
        break;
      case ConversationState.ASKING_CARD:
        this.logger.log('Estado ASKING_CARD, llamando handleCardSelection...');
        await this.handleCardSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_SPLIT:
        this.logger.log(
          'Estado ASKING_SPLIT, llamando handleSplitSelection...',
        );
        await this.handleSplitSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_SPLIT_OPTION:
        this.logger.log(
          'Estado ASKING_SPLIT_OPTION, llamando handleSplitOptionSelection...',
        );
        await this.handleSplitOptionSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.ASKING_SPLIT_PARTICIPANTS:
        this.logger.log(
          'Estado ASKING_SPLIT_PARTICIPANTS, llamando handleSplitParticipantsSelection...',
        );
        await this.handleSplitParticipantsSelection(
          botUpdate,
          text,
          telegramUserId,
        );
        break;
      case ConversationState.ASKING_STATUS:
        this.logger.log(
          'Estado ASKING_STATUS, llamando handleStatusSelection...',
        );
        await this.handleStatusSelection(botUpdate, text, telegramUserId);
        break;
      case ConversationState.CONFIRMING:
        this.logger.log('Estado CONFIRMING, enviando mensaje...');
        await this.telegramClient.sendMessage(
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
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ Error: Usuario no vinculado. Usa /start <token> para vincular tu cuenta.',
      );
      return;
    }

    const trips = await this.tripsService.findAll(botUpdate.userId.toString());

    if (trips.length === 0) {
      await this.telegramClient.sendMessage(
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
    this.logger.log(
      `parsed.isDivisible value: ${parsed.isDivisible} (type: ${typeof parsed.isDivisible})`,
    );

    if (!parsed.amount) {
      await this.telegramClient.sendMessage(
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

    const hasSharedKeywords =
      /(?:compartido|entre todos|dividido|todos|grupo)/i.test(text);
    const hasPersonalKeywords = /(?:solo|mío|personal|propio|individual)/i.test(
      text,
    );

    let isDivisibleValue: boolean | undefined;
    if (hasSharedKeywords) {
      isDivisibleValue = true;
    } else if (hasPersonalKeywords) {
      isDivisibleValue = false;
    } else {
      isDivisibleValue = undefined;
    }

    this.logger.log(
      `Setting isDivisible to: ${isDivisibleValue} (hasSharedKeywords: ${hasSharedKeywords}, hasPersonalKeywords: ${hasPersonalKeywords})`,
    );

    botUpdate.pendingExpense = {
      amount: parsed.amount,
      currency: parsed.currency || 'USD',
      description: parsed.description || text,
      merchantName,
      isDivisible: isDivisibleValue,
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
    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const context = {
      userName,
      trips: trips.map((t) => ({
        id: t._id.toString(),
        name: t.name || 'Viaje sin nombre',
      })),
      participants: [],
      budgets: [],
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { tripId: true },
    };

    const conversationalResponse =
      await this.conversationalService.generateResponse('', context);

    const message =
      conversationalResponse?.message || '✈️ ¿Para qué viaje es este gasto?';

    const buttons = trips.slice(0, 10).map((trip) => ({
      text: trip.name || 'Viaje sin nombre',
      callback_data: `trip:${trip._id.toString()}`,
    }));

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async askForBucket(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    budgets: PopulatedBudget[],
  ): Promise<void> {
    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const tripId = botUpdate.currentTripId!.toString();
    const participants = await this.participantsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );
    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const context = {
      userName,
      trips: [],
      participants: typedParticipants.map((p) => ({
        id: p._id.toString(),
        name:
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante'),
        isUser: !!(
          p.userId &&
          typeof p.userId === 'object' &&
          'firstName' in p.userId &&
          p.userId._id.toString() === botUpdate.userId!.toString()
        ),
      })),
      budgets: budgets.map((b) => ({
        id: b._id.toString(),
        name: b.name,
      })),
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { budgetId: true },
    };

    const conversationalResponse =
      await this.conversationalService.generateResponse('', context);

    const message =
      conversationalResponse?.message ||
      '📂 ¿A qué presupuesto corresponde este gasto?';

    const buttons = budgets.slice(0, 10).map((budget) => ({
      text: budget.name,
      callback_data: `bucket:${budget._id.toString()}`,
    }));

    buttons.push({ text: '❌ Sin presupuesto', callback_data: 'bucket:none' });

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
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

    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const context = {
      userName,
      trips: typedTrips.map((t) => ({
        id: t._id.toString(),
        name: t.name || 'Viaje sin nombre',
      })),
      participants: [],
      budgets: [],
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { tripId: true },
    };

    const parsedResponse =
      await this.conversationalService.parseNaturalResponse(
        text,
        context,
        'trip',
      );

    let matchedTrip: { _id: Types.ObjectId; name?: string } | undefined;

    if (parsedResponse.understood && parsedResponse.extracted?.tripId) {
      matchedTrip = typedTrips.find(
        (t) => t._id.toString() === parsedResponse.extracted?.tripId,
      );
    }

    if (!matchedTrip) {
      matchedTrip = typedTrips.find((t) =>
        t.name?.toLowerCase().includes(text.toLowerCase()),
      );
    }

    if (matchedTrip) {
      const tripId = matchedTrip._id.toString();
      botUpdate.currentTripId = new Types.ObjectId(tripId);
      await botUpdate.save();
      await this.continueWithTrip(botUpdate, telegramUserId, tripId);
    } else {
      const conversationalResponse =
        await this.conversationalService.generateResponse(text, context);
      const errorMessage =
        conversationalResponse?.message ||
        '⚠️ No encontré ese viaje. Por favor, selecciona uno de los botones o escribe el nombre exacto.';
      await this.telegramClient.sendMessage(telegramUserId, errorMessage);
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

    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const participants = await this.participantsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );
    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const context = {
      userName,
      trips: [],
      participants: typedParticipants.map((p) => ({
        id: p._id.toString(),
        name:
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante'),
        isUser: !!(
          p.userId &&
          typeof p.userId === 'object' &&
          'firstName' in p.userId &&
          p.userId._id.toString() === botUpdate.userId!.toString()
        ),
      })),
      budgets: budgets.map((b) => ({
        id: b._id.toString(),
        name: b.name,
      })),
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { budgetId: true },
    };

    const parsedResponse =
      await this.conversationalService.parseNaturalResponse(
        text,
        context,
        'budget',
      );

    let matchedBudget: PopulatedBudget | undefined;

    if (parsedResponse.understood && parsedResponse.extracted?.budgetId) {
      matchedBudget = budgets.find(
        (b) => b._id.toString() === parsedResponse.extracted?.budgetId,
      );
    }

    if (!matchedBudget) {
      if (
        text.toLowerCase().includes('sin') ||
        text.toLowerCase().includes('ninguno')
      ) {
        matchedBudget = undefined;
      } else {
        matchedBudget = budgets.find((b) =>
          b.name.toLowerCase().includes(text.toLowerCase()),
        );
      }
    }

    if (
      matchedBudget !== undefined ||
      text.toLowerCase().includes('sin') ||
      text.toLowerCase().includes('ninguno')
    ) {
      const updatedBotUpdate = await this.botUpdateModel
        .findById(botUpdate._id)
        .exec();
      if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
        return;
      }

      updatedBotUpdate.pendingExpense.budgetId = matchedBudget
        ? matchedBudget._id.toString()
        : undefined;
      updatedBotUpdate.markModified('pendingExpense');

      if (!updatedBotUpdate.pendingExpense.paidByParticipantId) {
        updatedBotUpdate.state = ConversationState.ASKING_PAYER;
        await updatedBotUpdate.save();
        await this.askForPayer(updatedBotUpdate, telegramUserId);
        return;
      }

      if (!updatedBotUpdate.pendingExpense.merchantName) {
        updatedBotUpdate.state = ConversationState.ASKING_MERCHANT;
        await updatedBotUpdate.save();
        await this.askForMerchant(updatedBotUpdate, telegramUserId);
        return;
      }

      if (
        updatedBotUpdate.pendingExpense.isDivisible === undefined ||
        updatedBotUpdate.pendingExpense.isDivisible === null
      ) {
        updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
        await updatedBotUpdate.save();
        await this.askForSplit(updatedBotUpdate, telegramUserId);
        return;
      }

      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
    } else {
      const conversationalResponse =
        await this.conversationalService.generateResponse(text, context);
      const errorMessage =
        conversationalResponse?.message ||
        '⚠️ No encontré ese presupuesto. Por favor, selecciona uno de los botones o escribe el nombre exacto.';
      await this.telegramClient.sendMessage(telegramUserId, errorMessage);
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

    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const budgetsResult: unknown = await this.budgetsService.findAll(
      tripId,
      botUpdate.userId!.toString(),
    );
    const budgets = budgetsResult as PopulatedBudget[];

    const context = {
      userName,
      trips: [],
      participants: typedParticipants.map((p) => ({
        id: p._id.toString(),
        name:
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante'),
        isUser: !!(
          p.userId &&
          typeof p.userId === 'object' &&
          'firstName' in p.userId &&
          p.userId._id.toString() === botUpdate.userId!.toString()
        ),
      })),
      budgets: budgets.map((b) => ({
        id: b._id.toString(),
        name: b.name,
      })),
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { paidBy: true },
    };

    const conversationalResponse =
      await this.conversationalService.generateResponse('', context);

    const message =
      conversationalResponse?.message || '💳 ¿Quién pagó este gasto?';

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

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handlePayerSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const tripId = botUpdate.currentTripId!.toString();
    const participants = await this.participantsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );
    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const budgetsResult: unknown = await this.budgetsService.findAll(
      tripId,
      botUpdate.userId!.toString(),
    );
    const budgets = budgetsResult as PopulatedBudget[];

    const context = {
      userName,
      trips: [],
      participants: typedParticipants.map((p) => ({
        id: p._id.toString(),
        name:
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante'),
        isUser: !!(
          p.userId &&
          typeof p.userId === 'object' &&
          'firstName' in p.userId &&
          p.userId._id.toString() === botUpdate.userId!.toString()
        ),
      })),
      budgets: budgets.map((b) => ({
        id: b._id.toString(),
        name: b.name,
      })),
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { paidBy: true },
    };

    const parsedResponse =
      await this.conversationalService.parseNaturalResponse(
        text,
        context,
        'payer',
      );

    let matchedParticipantId: string | undefined;

    if (
      parsedResponse.understood &&
      parsedResponse.extracted?.paidByParticipantId
    ) {
      matchedParticipantId = parsedResponse.extracted.paidByParticipantId;
    } else if (
      text.toLowerCase().includes('yo') ||
      text.toLowerCase().includes('mí') ||
      text.toLowerCase().includes('pagué') ||
      text.toLowerCase().includes('pague')
    ) {
      const userParticipant =
        (await this.participantsService.findUserParticipant(
          tripId,
          botUpdate.userId!.toString(),
        )) as unknown as PopulatedParticipant | null;
      if (userParticipant) {
        matchedParticipantId = userParticipant._id.toString();
      }
    } else {
      const matchedParticipant = typedParticipants.find((p) => {
        const name =
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante');
        return text.toLowerCase().includes(name.toLowerCase());
      });
      if (matchedParticipant) {
        matchedParticipantId = matchedParticipant._id.toString();
      }
    }

    if (matchedParticipantId) {
      const updatedBotUpdate = await this.botUpdateModel
        .findById(botUpdate._id)
        .exec();
      if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
        return;
      }

      updatedBotUpdate.pendingExpense.paidByParticipantId =
        matchedParticipantId;
      updatedBotUpdate.markModified('pendingExpense');

      if (!updatedBotUpdate.pendingExpense.merchantName) {
        updatedBotUpdate.state = ConversationState.ASKING_MERCHANT;
        await updatedBotUpdate.save();
        await this.askForMerchant(updatedBotUpdate, telegramUserId);
        return;
      }

      if (
        updatedBotUpdate.pendingExpense.isDivisible === undefined ||
        updatedBotUpdate.pendingExpense.isDivisible === null
      ) {
        updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
        await updatedBotUpdate.save();
        await this.askForSplit(updatedBotUpdate, telegramUserId);
        return;
      }

      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
    } else {
      const conversationalResponse =
        await this.conversationalService.generateResponse(text, context);
      const errorMessage =
        conversationalResponse?.message ||
        '⚠️ No entendí quién pagó. Por favor, selecciona uno de los botones o escribe el nombre.';
      await this.telegramClient.sendMessage(telegramUserId, errorMessage);
    }
  }

  private async askForMerchant(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const tripId = botUpdate.currentTripId!.toString();
    const participants = await this.participantsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );
    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const budgetsResult: unknown = await this.budgetsService.findAll(
      tripId,
      botUpdate.userId!.toString(),
    );
    const budgets = budgetsResult as PopulatedBudget[];

    const context = {
      userName,
      trips: [],
      participants: typedParticipants.map((p) => ({
        id: p._id.toString(),
        name:
          p.guestName ||
          (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
            ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
            : 'Participante'),
        isUser: !!(
          p.userId &&
          typeof p.userId === 'object' &&
          'firstName' in p.userId &&
          p.userId._id.toString() === botUpdate.userId!.toString()
        ),
      })),
      budgets: budgets.map((b) => ({
        id: b._id.toString(),
        name: b.name,
      })),
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { merchantName: true },
    };

    const conversationalResponse =
      await this.conversationalService.generateResponse('', context);

    const message =
      conversationalResponse?.message ||
      '🏪 ¿En qué comercio hiciste este gasto? (Puedes escribir "sin comercio" si no aplica)';

    await this.telegramClient.sendMessage(telegramUserId, message);
  }

  private async handleMerchantSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    let merchantName: string | undefined;

    if (
      text.toLowerCase().includes('sin') &&
      (text.toLowerCase().includes('comercio') ||
        text.toLowerCase().includes('tienda') ||
        text.toLowerCase().includes('lugar'))
    ) {
      merchantName = undefined;
    } else {
      merchantName = text.trim();
      if (merchantName.length > 100) {
        merchantName = merchantName.substring(0, 100);
      }
      merchantName = merchantName
        .split(' ')
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(' ');
    }

    updatedBotUpdate.pendingExpense.merchantName = merchantName;
    updatedBotUpdate.markModified('pendingExpense');

    if (
      updatedBotUpdate.pendingExpense.isDivisible === undefined ||
      updatedBotUpdate.pendingExpense.isDivisible === null
    ) {
      updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
      await updatedBotUpdate.save();
      await this.askForSplit(updatedBotUpdate, telegramUserId);
      return;
    }

    if (!updatedBotUpdate.pendingExpense.paymentMethod) {
      updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
      await updatedBotUpdate.save();
      await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
      return;
    }

    updatedBotUpdate.state = ConversationState.CONFIRMING;
    await updatedBotUpdate.save();
    await this.showConfirmation(updatedBotUpdate, telegramUserId);
  }

  private async askForPaymentMethod(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const user = await this.userModel.findById(botUpdate.userId).exec();
    const userName = user
      ? `${user.firstName} ${user.lastName}`.trim()
      : 'Usuario';

    const context = {
      userName,
      trips: [],
      participants: [],
      budgets: [],
      pendingExpense: botUpdate.pendingExpense,
      missingInfo: { paymentMethod: true },
    };

    const conversationalResponse =
      await this.conversationalService.generateResponse('', context);

    const message =
      conversationalResponse?.message ||
      '💳 ¿Pagaste con efectivo o con tarjeta?';

    const buttons = [
      { text: '💵 Efectivo', callback_data: 'payment:cash' },
      { text: '💳 Tarjeta', callback_data: 'payment:card' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handlePaymentMethodSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    let paymentMethod: string | undefined;

    if (
      text.toLowerCase().includes('efectivo') ||
      text.toLowerCase().includes('cash') ||
      text.toLowerCase().includes('dinero')
    ) {
      paymentMethod = PaymentMethod.CASH;
    } else if (
      text.toLowerCase().includes('tarjeta') ||
      text.toLowerCase().includes('card') ||
      text.toLowerCase().includes('crédito') ||
      text.toLowerCase().includes('débito')
    ) {
      paymentMethod = PaymentMethod.CARD;
    }

    if (paymentMethod) {
      updatedBotUpdate.pendingExpense.paymentMethod = paymentMethod;
      updatedBotUpdate.markModified('pendingExpense');

      const paymentMethodStr = String(paymentMethod);
      if (
        paymentMethodStr === String(PaymentMethod.CARD) ||
        paymentMethodStr === 'card'
      ) {
        updatedBotUpdate.state = ConversationState.ASKING_CARD;
        await updatedBotUpdate.save();
        await this.askForCard(updatedBotUpdate, telegramUserId);
        return;
      }

      updatedBotUpdate.state = ConversationState.ASKING_STATUS;
      await updatedBotUpdate.save();
      await this.askForStatus(updatedBotUpdate, telegramUserId);
    } else {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No entendí. Por favor, responde "efectivo" o "tarjeta".',
      );
    }
  }

  private async askForCard(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const tripId = botUpdate.currentTripId!.toString();
    const cards = await this.cardsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );

    if (cards.length === 0) {
      const user = await this.userModel.findById(botUpdate.userId).exec();
      const userName = user
        ? `${user.firstName} ${user.lastName}`.trim()
        : 'Usuario';

      const context = {
        userName,
        trips: [],
        participants: [],
        budgets: [],
        pendingExpense: botUpdate.pendingExpense,
      };

      const conversationalResponse =
        await this.conversationalService.generateResponse(
          'No hay tarjetas registradas para este viaje. El usuario debe registrar una tarjeta primero.',
          context,
        );

      const message =
        conversationalResponse?.message ||
        '⚠️ No hay tarjetas registradas para este viaje. Por favor, registra una tarjeta primero desde la web.';

      await this.telegramClient.sendMessage(telegramUserId, message);
      return;
    }

    const message = '💳 ¿Con qué tarjeta pagaste este gasto?';

    const buttons = cards.slice(0, 10).map((card) => ({
      text: `${card.name} (****${card.lastFourDigits})`,
      callback_data: `card:${getCardId(card)}`,
    }));

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handleCardSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const tripId = botUpdate.currentTripId!.toString();
    const cards = await this.cardsService.findByTrip(
      tripId,
      botUpdate.userId!.toString(),
    );

    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const matchedCard = cards.find((c) => {
      const cardName = c.name.toLowerCase();
      const cardDigits = c.lastFourDigits;
      return (
        text.toLowerCase().includes(cardName) ||
        text.includes(cardDigits) ||
        text.toLowerCase().includes(`****${cardDigits}`)
      );
    });

    if (matchedCard) {
      updatedBotUpdate.pendingExpense.cardId = getCardId(matchedCard);
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_STATUS;
      await updatedBotUpdate.save();
      await this.askForStatus(updatedBotUpdate, telegramUserId);
    } else {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No encontré esa tarjeta. Por favor, selecciona una de las opciones o escribe el nombre o los últimos 4 dígitos.',
      );
    }
  }

  private async askForSplit(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    this.logger.log('=== askForSplit llamado ===');
    this.logger.log(
      `pendingExpense.isDivisible: ${botUpdate.pendingExpense?.isDivisible}`,
    );
    this.logger.log(
      `pendingExpense completo: ${JSON.stringify(botUpdate.pendingExpense)}`,
    );

    const message = '📊 ¿Es un gasto personal o compartido?';

    const buttons = [
      { text: '👤 Personal', callback_data: 'split:personal' },
      { text: '👥 Compartido', callback_data: 'split:shared' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handleSplitSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const isPersonal =
      text.toLowerCase().includes('personal') ||
      text.toLowerCase().includes('solo') ||
      text.toLowerCase().includes('mío') ||
      text.toLowerCase().includes('mio');

    const isShared =
      text.toLowerCase().includes('compartido') ||
      text.toLowerCase().includes('todos') ||
      text.toLowerCase().includes('grupo');

    if (isPersonal) {
      updatedBotUpdate.pendingExpense.isDivisible = false;
      updatedBotUpdate.pendingExpense.splitType = undefined;
      updatedBotUpdate.pendingExpense.splits = undefined;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
      await updatedBotUpdate.save();
      await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
      return;
    }

    if (isShared) {
      updatedBotUpdate.pendingExpense.isDivisible = true;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_SPLIT_OPTION;
      await updatedBotUpdate.save();
      await this.askForSplitOption(updatedBotUpdate, telegramUserId);
      return;
    }

    await this.telegramClient.sendMessage(
      telegramUserId,
      '⚠️ Por favor, selecciona si es personal o compartido.',
    );
  }

  private async askForSplitOption(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const message =
      '📊 ¿Este gasto compartido es para todos, algunos o una persona?';

    const buttons = [
      { text: '👥 Todos', callback_data: 'split-option:all' },
      { text: '👤 Algunos', callback_data: 'split-option:some' },
      { text: '👤 Una persona', callback_data: 'split-option:one' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handleSplitOptionSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const isAll =
      text.toLowerCase().includes('todos') ||
      text.toLowerCase().includes('all');

    const isSome =
      text.toLowerCase().includes('algunos') ||
      text.toLowerCase().includes('some');

    const isOne =
      text.toLowerCase().includes('una persona') ||
      text.toLowerCase().includes('una') ||
      text.toLowerCase().includes('one');

    if (isAll) {
      const tripId = updatedBotUpdate.currentTripId!.toString();
      const participants = await this.participantsService.findByTrip(
        tripId,
        updatedBotUpdate.userId!.toString(),
      );
      const typedParticipants =
        participants as unknown as PopulatedParticipant[];

      const amount = updatedBotUpdate.pendingExpense.amount || 0;
      const amountPerParticipant = amount / typedParticipants.length;

      updatedBotUpdate.pendingExpense.splitType = SplitType.EQUAL;
      updatedBotUpdate.pendingExpense.splits = typedParticipants.map((p) => ({
        participantId: p._id.toString(),
        amount: Number(amountPerParticipant.toFixed(2)),
      }));

      const totalCalculated = updatedBotUpdate.pendingExpense.splits.reduce(
        (sum, split) => sum + (split.amount || 0),
        0,
      );
      const difference = amount - totalCalculated;
      if (Math.abs(difference) > 0.01) {
        const lastSplit =
          updatedBotUpdate.pendingExpense.splits[
            updatedBotUpdate.pendingExpense.splits.length - 1
          ];
        if (lastSplit && lastSplit.amount !== undefined) {
          lastSplit.amount = Number((lastSplit.amount + difference).toFixed(2));
        }
      }

      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
      await updatedBotUpdate.save();
      await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
      return;
    }

    if (isSome || isOne) {
      updatedBotUpdate.pendingExpense.selectedParticipants = [];
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_SPLIT_PARTICIPANTS;
      await updatedBotUpdate.save();
      await this.askForSplitParticipants(
        updatedBotUpdate,
        telegramUserId,
        isOne,
      );
      return;
    }

    await this.telegramClient.sendMessage(
      telegramUserId,
      '⚠️ Por favor, selecciona una opción.',
    );
  }

  private async askForSplitParticipants(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    isOne: boolean,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate) return;

    const selectedParticipants: string[] =
      updatedBotUpdate.pendingExpense?.selectedParticipants || [];

    const tripId = updatedBotUpdate.currentTripId!.toString();
    const participants = await this.participantsService.findByTrip(
      tripId,
      updatedBotUpdate.userId!.toString(),
    );
    const typedParticipants = participants as unknown as PopulatedParticipant[];

    const message = isOne
      ? '👤 ¿Para quién es este gasto?'
      : `👥 Selecciona los participantes (${selectedParticipants.length} seleccionado${selectedParticipants.length !== 1 ? 's' : ''}):\n\nPresiona los nombres para seleccionar/deseleccionar. Luego presiona "✅ Listo" cuando termines.`;

    const MAX_SHOWN = 10;
    const buttons = typedParticipants.slice(0, MAX_SHOWN).map((p) => {
      const name =
        p.guestName ||
        (p.userId && typeof p.userId === 'object' && 'firstName' in p.userId
          ? `${p.userId.firstName} ${p.userId.lastName}`.trim()
          : 'Participante');
      const isSelected = selectedParticipants.includes(p._id.toString());
      return {
        text: isSelected ? `✅ ${name}` : `☐ ${name}`,
        callback_data: `split-participant:${p._id.toString()}`,
      };
    });

    if (!isOne && buttons.length > 0) {
      buttons.push({
        text: `✅ Listo${selectedParticipants.length > 0 ? ` (${selectedParticipants.length})` : ''}`,
        callback_data: 'split-participants:done',
      });
    }

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handleSplitParticipantsSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const selectedParticipants: string[] =
      updatedBotUpdate.pendingExpense.selectedParticipants || [];

    if (
      text.toLowerCase().includes('listo') ||
      text.toLowerCase().includes('done')
    ) {
      if (selectedParticipants.length === 0) {
        await this.telegramClient.sendMessage(
          telegramUserId,
          '⚠️ Debes seleccionar al menos un participante.',
        );
        return;
      }

      const amount = updatedBotUpdate.pendingExpense.amount || 0;
      const amountPerParticipant = amount / selectedParticipants.length;

      updatedBotUpdate.pendingExpense.splitType = SplitType.EQUAL;
      updatedBotUpdate.pendingExpense.splits = selectedParticipants.map(
        (id) => ({
          participantId: id,
          amount: Number(amountPerParticipant.toFixed(2)),
        }),
      );

      const totalCalculated = updatedBotUpdate.pendingExpense.splits.reduce(
        (sum, split) => sum + (split.amount || 0),
        0,
      );
      const difference = amount - totalCalculated;
      if (Math.abs(difference) > 0.01) {
        const lastSplit =
          updatedBotUpdate.pendingExpense.splits[
            updatedBotUpdate.pendingExpense.splits.length - 1
          ];
        if (lastSplit && lastSplit.amount !== undefined) {
          lastSplit.amount = Number((lastSplit.amount + difference).toFixed(2));
        }
      }

      updatedBotUpdate.pendingExpense.selectedParticipants = undefined;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
      await updatedBotUpdate.save();
      await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
      return;
    }

    await this.telegramClient.sendMessage(
      telegramUserId,
      '⚠️ Por favor, selecciona los participantes usando los botones.',
    );
  }

  private async askForStatus(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const message = '💵 ¿El gasto está pagado o pendiente?';

    const buttons = [
      { text: '✅ Pagado', callback_data: 'status:paid' },
      { text: '⏳ Pendiente', callback_data: 'status:pending' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async handleStatusSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
      return;
    }

    const isPaid =
      text.toLowerCase().includes('pagado') ||
      text.toLowerCase().includes('paid') ||
      text.toLowerCase().includes('pago');

    const isPending =
      text.toLowerCase().includes('pendiente') ||
      text.toLowerCase().includes('pending') ||
      text.toLowerCase().includes('faltante');

    if (isPaid) {
      updatedBotUpdate.pendingExpense.status = ExpenseStatus.PAID;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      return;
    }

    if (isPending) {
      updatedBotUpdate.pendingExpense.status = ExpenseStatus.PENDING;
      updatedBotUpdate.markModified('pendingExpense');
      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      return;
    }

    await this.telegramClient.sendMessage(
      telegramUserId,
      '⚠️ Por favor, selecciona si está pagado o pendiente.',
    );
  }

  private async handleCallbackQuery(
    callback: TelegramUpdate['callback_query'],
  ): Promise<void> {
    if (!callback) return;

    const telegramUserId = callback.from.id;
    const data = callback.data;
    const callbackQueryId = callback.id;
    let botUpdate =
      await this.botUpdateRepository.getOrCreateBotUpdate(telegramUserId);

    if (!botUpdate.userId) {
      await this.telegramClient.answerCallbackQuery(
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
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        updatedBotUpdate.currentTripId = new Types.ObjectId(tripId);
        await updatedBotUpdate.save();
        await this.continueWithTrip(updatedBotUpdate, telegramUserId, tripId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('bucket:')) {
        const bucketId = data.replace('bucket:', '');
        this.logger.log(`Callback bucket recibido - bucketId raw: ${bucketId}`);

        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
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
          await this.telegramClient.answerCallbackQuery(callbackQueryId);
          return;
        }

        if (
          updatedBotUpdate.pendingExpense.isDivisible === undefined ||
          updatedBotUpdate.pendingExpense.isDivisible === null
        ) {
          updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
          await updatedBotUpdate.save();
          await this.askForSplit(updatedBotUpdate, telegramUserId);
          await this.telegramClient.answerCallbackQuery(callbackQueryId);
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
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('payer:')) {
        await this.handlePayerCallback(
          botUpdate,
          data,
          telegramUserId,
          callbackQueryId,
        );
      } else if (data.startsWith('payment:')) {
        const paymentMethod = data.replace('payment:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        updatedBotUpdate.pendingExpense.paymentMethod = paymentMethod;
        updatedBotUpdate.markModified('pendingExpense');

        if (paymentMethod === 'card') {
          updatedBotUpdate.state = ConversationState.ASKING_CARD;
          await updatedBotUpdate.save();
          await this.askForCard(updatedBotUpdate, telegramUserId);
        } else {
          updatedBotUpdate.state = ConversationState.ASKING_STATUS;
          await updatedBotUpdate.save();
          await this.askForStatus(updatedBotUpdate, telegramUserId);
        }
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('card:')) {
        const cardId = data.replace('card:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        updatedBotUpdate.pendingExpense.cardId = cardId;
        updatedBotUpdate.markModified('pendingExpense');
        updatedBotUpdate.state = ConversationState.ASKING_STATUS;
        await updatedBotUpdate.save();
        await this.askForStatus(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('split:')) {
        const splitType = data.replace('split:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        const splitText =
          splitType === 'personal'
            ? 'personal'
            : splitType === 'shared'
              ? 'compartido'
              : splitType;
        await this.handleSplitSelection(
          updatedBotUpdate,
          splitText,
          telegramUserId,
        );
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('split-option:')) {
        const splitOption = data.replace('split-option:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        const optionText =
          splitOption === 'all'
            ? 'todos'
            : splitOption === 'some'
              ? 'algunos'
              : splitOption === 'one'
                ? 'una persona'
                : splitOption;
        await this.handleSplitOptionSelection(
          updatedBotUpdate,
          optionText,
          telegramUserId,
        );
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (
        data.startsWith('split-participant:') ||
        data.startsWith('split-participants:')
      ) {
        const participantData = data
          .replace('split-participant:', '')
          .replace('split-participants:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        if (participantData === 'done') {
          await this.handleSplitParticipantsSelection(
            updatedBotUpdate,
            'listo',
            telegramUserId,
          );
          await this.telegramClient.answerCallbackQuery(callbackQueryId);
        } else {
          const selectedParticipants: string[] =
            updatedBotUpdate.pendingExpense.selectedParticipants || [];

          const participantIndex =
            selectedParticipants.indexOf(participantData);
          const isSelected = participantIndex !== -1;

          if (isSelected) {
            selectedParticipants.splice(participantIndex, 1);
          } else {
            selectedParticipants.push(participantData);
          }

          updatedBotUpdate.pendingExpense.selectedParticipants =
            selectedParticipants;
          updatedBotUpdate.markModified('pendingExpense');
          await updatedBotUpdate.save();

          const tripId = updatedBotUpdate.currentTripId!.toString();
          const participants = await this.participantsService.findByTrip(
            tripId,
            updatedBotUpdate.userId!.toString(),
          );
          const typedParticipants =
            participants as unknown as PopulatedParticipant[];

          const selectedParticipant = typedParticipants.find(
            (p) => p._id.toString() === participantData,
          );
          const name =
            selectedParticipant?.guestName ||
            (selectedParticipant?.userId &&
            typeof selectedParticipant.userId === 'object' &&
            'firstName' in selectedParticipant.userId
              ? `${selectedParticipant.userId.firstName} ${selectedParticipant.userId.lastName}`.trim()
              : 'Participante');

          const savedBotUpdate = await this.botUpdateModel
            .findById(updatedBotUpdate._id)
            .exec();

          if (savedBotUpdate) {
            await this.askForSplitParticipants(
              savedBotUpdate,
              telegramUserId,
              false,
            );
            await this.telegramClient.answerCallbackQuery(
              callbackQueryId,
              isSelected
                ? `✅ ${name} seleccionado`
                : `☐ ${name} deseleccionado`,
            );
          } else {
            await this.telegramClient.answerCallbackQuery(callbackQueryId);
          }
        }
      } else if (data.startsWith('status:')) {
        const statusType = data.replace('status:', '');
        const updatedBotUpdate = await this.botUpdateModel
          .findById(botUpdate._id)
          .exec();
        if (!updatedBotUpdate || !updatedBotUpdate.pendingExpense) {
          await this.telegramClient.answerCallbackQuery(
            callbackQueryId,
            '⚠️ Error: No se encontró el gasto.',
          );
          return;
        }

        const statusText =
          statusType === 'paid'
            ? 'pagado'
            : statusType === 'pending'
              ? 'pendiente'
              : statusType;
        await this.handleStatusSelection(
          updatedBotUpdate,
          statusText,
          telegramUserId,
        );
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      } else if (data.startsWith('confirm:')) {
        if (data === 'confirm:yes') {
          await this.confirmExpense(botUpdate, telegramUserId);
        } else {
          await this.cancelExpense(botUpdate, telegramUserId);
        }
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
      }
    } catch (error) {
      this.logger.error('Error procesando callback:', error);
      await this.telegramClient.answerCallbackQuery(
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
      await this.telegramClient.sendMessage(
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

      if (!updatedBotUpdate.pendingExpense.merchantName) {
        updatedBotUpdate.state = ConversationState.ASKING_MERCHANT;
        await updatedBotUpdate.save();
        await this.askForMerchant(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      if (
        updatedBotUpdate.pendingExpense.isDivisible === undefined ||
        updatedBotUpdate.pendingExpense.isDivisible === null
      ) {
        updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
        await updatedBotUpdate.save();
        await this.askForSplit(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      if (!updatedBotUpdate.pendingExpense.paymentMethod) {
        updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
        await updatedBotUpdate.save();
        await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      await this.telegramClient.answerCallbackQuery(callbackQueryId);
    } else if (data.startsWith('payer:participant:')) {
      const participantId = data.replace('payer:participant:', '');
      updatedBotUpdate.pendingExpense.paidByParticipantId = participantId;
      updatedBotUpdate.markModified('pendingExpense');

      if (!updatedBotUpdate.pendingExpense.merchantName) {
        updatedBotUpdate.state = ConversationState.ASKING_MERCHANT;
        await updatedBotUpdate.save();
        await this.askForMerchant(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      if (
        updatedBotUpdate.pendingExpense.isDivisible === undefined ||
        updatedBotUpdate.pendingExpense.isDivisible === null
      ) {
        updatedBotUpdate.state = ConversationState.ASKING_SPLIT;
        await updatedBotUpdate.save();
        await this.askForSplit(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      if (!updatedBotUpdate.pendingExpense.paymentMethod) {
        updatedBotUpdate.state = ConversationState.ASKING_PAYMENT_METHOD;
        await updatedBotUpdate.save();
        await this.askForPaymentMethod(updatedBotUpdate, telegramUserId);
        await this.telegramClient.answerCallbackQuery(callbackQueryId);
        return;
      }

      updatedBotUpdate.state = ConversationState.CONFIRMING;
      await updatedBotUpdate.save();
      await this.showConfirmation(updatedBotUpdate, telegramUserId);
      await this.telegramClient.answerCallbackQuery(callbackQueryId);
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

      await this.telegramClient.sendMessageWithButtons(
        telegramUserId,
        '👥 Selecciona quién pagó:',
        buttons,
      );
      await this.telegramClient.answerCallbackQuery(callbackQueryId);
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

    let splitLine = '';
    if (expense.isDivisible && expense.splits && expense.splits.length > 0) {
      const tripId = botUpdate.currentTripId!.toString();
      const participants = await this.participantsService.findByTrip(
        tripId,
        botUpdate.userId!.toString(),
      );
      const typedParticipants =
        participants as unknown as PopulatedParticipant[];

      const splitDetails = expense.splits
        .map((split) => {
          const participant = typedParticipants.find(
            (p) => p._id.toString() === split.participantId,
          );
          const name =
            participant?.guestName ||
            (participant?.userId &&
            typeof participant.userId === 'object' &&
            'firstName' in participant.userId
              ? `${participant.userId.firstName} ${participant.userId.lastName}`.trim()
              : 'Participante');
          return `  • ${name}: ${expense.currency || 'USD'} ${split.amount}`;
        })
        .join('\n');
      splitLine = `\n📊 *División:*\n${splitDetails}\n`;
    }

    const statusText =
      expense.status === ExpenseStatus.PENDING ? '⏳ Pendiente' : '✅ Pagado';

    const message =
      '📋 *Resumen del gasto:*\n\n' +
      `💰 *Monto:* ${expense.amount} ${expense.currency || 'USD'}\n` +
      `📝 *Descripción:* ${expense.description || 'Sin descripción'}\n` +
      merchantLine +
      `📂 *Presupuesto:* ${budgetName}\n` +
      `💳 *Pagó:* ${payerName}\n` +
      `📊 *Tipo:* ${expense.isDivisible ? 'Compartido' : 'Personal'}` +
      splitLine +
      `\n${statusText}`;

    const buttons = [
      { text: '✅ Confirmar', callback_data: 'confirm:yes' },
      { text: '❌ Cancelar', callback_data: 'confirm:no' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async confirmExpense(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
  ): Promise<void> {
    const updatedBotUpdate = await this.botUpdateModel
      .findById(botUpdate._id)
      .exec();
    if (!updatedBotUpdate) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Error: No se pudo cargar el gasto.',
      );
      return;
    }

    const expense = updatedBotUpdate.pendingExpense;
    if (!expense || !updatedBotUpdate.currentTripId) {
      await this.telegramClient.sendMessage(
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
        status: (expense.status as ExpenseStatus) || ExpenseStatus.PAID,
        paymentMethod:
          (expense.paymentMethod as PaymentMethod) || PaymentMethod.CASH,
        cardId: expense.cardId,
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

      const user = await this.userModel
        .findById(updatedBotUpdate.userId)
        .exec();
      const userName = user
        ? `${user.firstName} ${user.lastName}`.trim()
        : 'Usuario';

      const trip = await this.tripsService.findOne(
        updatedBotUpdate.currentTripId.toString(),
        updatedBotUpdate.userId!.toString(),
      );
      const tripName =
        (trip as unknown as { name?: string })?.name || 'Viaje sin nombre';

      const expenseInfo = `${expense.amount} ${expense.currency || 'USD'} - ${expense.description || 'Sin descripción'}${expense.merchantName ? ` en ${expense.merchantName}` : ''} para ${tripName}`;

      const context = {
        userName,
        trips: [
          { id: updatedBotUpdate.currentTripId.toString(), name: tripName },
        ],
        participants: [],
        budgets: [],
      };

      const conversationalResponse =
        await this.conversationalService.generateResponse(
          `El usuario confirmó el gasto: ${expenseInfo}. Responde confirmando que se guardó exitosamente.`,
          context,
        );

      const confirmationMessage =
        conversationalResponse?.message ||
        '✅ ¡Gasto guardado exitosamente!\n\nPuedes verlo en tu dashboard web.';

      await this.telegramClient.sendMessage(
        telegramUserId,
        confirmationMessage,
      );
    } catch (error) {
      this.logger.error('Error creando gasto:', error);
      await this.telegramClient.sendMessage(
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

    await this.telegramClient.sendMessage(
      telegramUserId,
      '❌ Gasto cancelado.',
    );
  }

  async generateLinkToken(userId: string): Promise<string> {
    return this.userLinkingService.generateLinkToken(userId);
  }
}
