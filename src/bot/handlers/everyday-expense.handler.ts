import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BotUpdate,
  BotUpdateDocument,
  ConversationState,
} from '../bot-update.schema';
import { MessageParserService } from '../parsers/message-parser.service';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { CategoriesService } from '../../categories/categories.service';
import { PaymentMethodsService } from '../../payment-methods/payment-methods.service';
import { ExpensesService } from '../../expenses/expenses.service';
import { CreateExpenseDto } from '../../expenses/dto/create-expense.dto';
import { ExpenseStatus, PaymentMethod } from '../../expenses/expense.schema';
import { Category } from '../../categories/category.schema';
import { PaymentMethod as PaymentMethodEntity } from '../../payment-methods/payment-method.schema';
import { getDocumentId } from '../utils/bot-helpers';

@Injectable()
export class EverydayExpenseHandler {
  private readonly logger = new Logger(EverydayExpenseHandler.name);

  constructor(
    @InjectModel(BotUpdate.name)
    private botUpdateModel: Model<BotUpdateDocument>,
    private messageParser: MessageParserService,
    private telegramClient: TelegramClientService,
    private categoriesService: CategoriesService,
    private paymentMethodsService: PaymentMethodsService,
    private expensesService: ExpensesService,
  ) {}

  async startFromMessage(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const parsed = await this.messageParser.parse(text, {
      tripName: 'Everyday',
      participants: [],
      budgets: [],
      userName: 'Usuario',
    });

    if (!parsed.amount) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No pude detectar el monto. Incluí un número.\nEjemplo: "Super 15000"',
      );
      return;
    }

    botUpdate.pendingExpense = {
      amount: parsed.amount,
      currency: parsed.currency,
      description: this.normalizeDescription(parsed.description, text),
      isDivisible: false,
    };

    const categories = await this.categoriesService.findAllByBoard(
      boardId,
      botUpdate.userId!.toString(),
    );

    const matchedCategory = this.matchCategoryByText(categories, text);
    if (matchedCategory) {
      botUpdate.pendingExpense.categoryId = getDocumentId(matchedCategory);
      botUpdate.markModified('pendingExpense');
    }

    if (botUpdate.pendingExpense.categoryId) {
      await this.continueToPaymentMethod(
        botUpdate,
        telegramUserId,
        boardId,
        text,
      );
      return;
    }

    botUpdate.state = ConversationState.ASKING_CATEGORY;
    await botUpdate.save();
    await this.askForCategory(botUpdate, telegramUserId, categories);
  }

  async handleCategorySelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const categories = await this.categoriesService.findAllByBoard(
      boardId,
      botUpdate.userId!.toString(),
    );

    const matched = this.matchCategoryByText(categories, text);
    if (!matched) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No encontré esa categoría. Elegí una de los botones o escribí el nombre.',
      );
      return;
    }

    const updated = await this.reloadBotUpdate(botUpdate._id.toString());
    if (!updated?.pendingExpense) {
      return;
    }

    updated.pendingExpense.categoryId = getDocumentId(matched);
    updated.markModified('pendingExpense');
    await updated.save();

    await this.continueToPaymentMethod(updated, telegramUserId, boardId, text);
  }

  async handleCategoryCallback(
    botUpdate: BotUpdateDocument,
    categoryId: string,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const updated = await this.reloadBotUpdate(botUpdate._id.toString());
    if (!updated?.pendingExpense) {
      return;
    }

    updated.pendingExpense.categoryId = categoryId;
    updated.markModified('pendingExpense');
    await updated.save();

    await this.continueToPaymentMethod(updated, telegramUserId, boardId, '');
  }

  async handlePaymentSelection(
    botUpdate: BotUpdateDocument,
    text: string,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const methods = await this.paymentMethodsService.findAvailableForBoard(
      boardId,
      botUpdate.userId!.toString(),
    );

    const matched = this.matchPaymentMethodByText(methods, text);
    if (!matched) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No encontré ese medio de pago. Elegí uno de los botones.',
      );
      return;
    }

    const updated = await this.reloadBotUpdate(botUpdate._id.toString());
    if (!updated?.pendingExpense) {
      return;
    }

    updated.pendingExpense.paymentMethodId = getDocumentId(matched);
    updated.markModified('pendingExpense');
    updated.state = ConversationState.CONFIRMING;
    await updated.save();

    await this.showConfirmation(updated, telegramUserId, boardId, methods);
  }

  async handlePaymentCallback(
    botUpdate: BotUpdateDocument,
    paymentMethodId: string,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const updated = await this.reloadBotUpdate(botUpdate._id.toString());
    if (!updated?.pendingExpense) {
      return;
    }

    updated.pendingExpense.paymentMethodId = paymentMethodId;
    updated.markModified('pendingExpense');
    updated.state = ConversationState.CONFIRMING;
    await updated.save();

    const methods = await this.paymentMethodsService.findAvailableForBoard(
      boardId,
      botUpdate.userId!.toString(),
    );
    await this.showConfirmation(updated, telegramUserId, boardId, methods);
  }

  async confirmExpense(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    boardId: string,
  ): Promise<void> {
    const updated = await this.reloadBotUpdate(botUpdate._id.toString());
    const expense = updated?.pendingExpense;
    if (!updated || !expense?.amount || !expense.categoryId) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Error: faltan datos del gasto.',
      );
      return;
    }

    try {
      const createExpenseDto: CreateExpenseDto = {
        boardId,
        amount: expense.amount,
        ...(expense.currency ? { currency: expense.currency } : {}),
        description: expense.description || 'Gasto sin descripción',
        categoryId: expense.categoryId,
        paymentMethodId: expense.paymentMethodId,
        status: ExpenseStatus.PAID,
        paymentMethod: expense.paymentMethodId
          ? PaymentMethod.CARD
          : PaymentMethod.CASH,
        isDivisible: false,
        expenseDate: new Date().toISOString(),
      };

      await this.expensesService.create(
        createExpenseDto,
        updated.userId!.toString(),
      );

      updated.state = ConversationState.IDLE;
      updated.pendingExpense = undefined;
      await updated.save();

      await this.telegramClient.sendMessage(
        telegramUserId,
        '✅ ¡Gasto guardado en tu tablero everyday!\n\nPodés verlo en la web.',
      );
    } catch (error) {
      this.logger.error('Error creating everyday expense', error);
      await this.telegramClient.sendMessage(
        telegramUserId,
        '❌ Error al guardar el gasto. Revisá los datos e intentá de nuevo.',
      );
    }
  }

  private async continueToPaymentMethod(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    boardId: string,
    text: string,
  ): Promise<void> {
    const methods = await this.paymentMethodsService.findAvailableForBoard(
      boardId,
      botUpdate.userId!.toString(),
    );

    const matched = this.matchPaymentMethodByText(methods, text);
    if (matched) {
      botUpdate.pendingExpense!.paymentMethodId = getDocumentId(matched);
      botUpdate.markModified('pendingExpense');
      botUpdate.state = ConversationState.CONFIRMING;
      await botUpdate.save();
      await this.showConfirmation(botUpdate, telegramUserId, boardId, methods);
      return;
    }

    botUpdate.state = ConversationState.ASKING_EVERYDAY_PAYMENT;
    await botUpdate.save();
    await this.askForPaymentMethod(botUpdate, telegramUserId, methods);
  }

  private async askForCategory(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    categories: Category[],
  ): Promise<void> {
    if (categories.length === 0) {
      await this.telegramClient.sendMessage(
        telegramUserId,
        '⚠️ No hay categorías en este tablero. Configuralas desde la web.',
      );
      botUpdate.state = ConversationState.IDLE;
      botUpdate.pendingExpense = undefined;
      await botUpdate.save();
      return;
    }

    const message = '📂 ¿En qué categoría va este gasto?';
    const buttons = categories.slice(0, 10).map((category) => ({
      text: category.name,
      callback_data: `everyday-category:${getDocumentId(category)}`,
    }));

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async askForPaymentMethod(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    methods: PaymentMethodEntity[],
  ): Promise<void> {
    if (methods.length === 0) {
      const updated = await this.reloadBotUpdate(botUpdate._id.toString());
      if (!updated?.pendingExpense) {
        return;
      }

      updated.state = ConversationState.CONFIRMING;
      await updated.save();
      await this.showConfirmation(updated, telegramUserId, '', []);
      return;
    }

    const message = '💳 ¿Con qué medio pagaste?';
    const buttons = methods.slice(0, 10).map((method) => ({
      text: method.lastFourDigits
        ? `${method.name} (****${method.lastFourDigits})`
        : method.name,
      callback_data: `everyday-payment:${getDocumentId(method)}`,
    }));

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private async showConfirmation(
    botUpdate: BotUpdateDocument,
    telegramUserId: number,
    boardId: string,
    methods: PaymentMethodEntity[],
  ): Promise<void> {
    const expense = botUpdate.pendingExpense;
    if (!expense?.amount) {
      return;
    }

    let categoryName = 'Sin categoría';
    if (expense.categoryId && boardId) {
      const categories = await this.categoriesService.findAllByBoard(
        boardId,
        botUpdate.userId!.toString(),
      );
      categoryName =
        categories.find((c) => getDocumentId(c) === expense.categoryId)?.name ??
        categoryName;
    }

    let paymentName = 'Efectivo (sin medio registrado)';
    if (expense.paymentMethodId) {
      const method = methods.find(
        (m) => getDocumentId(m) === expense.paymentMethodId,
      );
      if (method) {
        paymentName = method.lastFourDigits
          ? `${method.name} (****${method.lastFourDigits})`
          : method.name;
      }
    }

    const amountLine = expense.currency
      ? `💰 *Monto:* ${expense.amount} ${expense.currency}`
      : `💰 *Monto:* ${expense.amount}`;

    const message =
      '📋 *Resumen del gasto (everyday):*\n\n' +
      `${amountLine}\n` +
      `📝 *Descripción:* ${expense.description || 'Sin descripción'}\n` +
      `📂 *Categoría:* ${categoryName}\n` +
      `💳 *Medio:* ${paymentName}`;

    const buttons = [
      { text: '✅ Confirmar', callback_data: 'everyday-confirm:yes' },
      { text: '❌ Cancelar', callback_data: 'confirm:no' },
    ];

    await this.telegramClient.sendMessageWithButtons(
      telegramUserId,
      message,
      buttons,
    );
  }

  private matchCategoryByText(
    categories: Category[],
    text: string,
  ): Category | undefined {
    const normalized = text.toLowerCase();
    return categories.find((category) =>
      normalized.includes(category.name.toLowerCase()),
    );
  }

  private matchPaymentMethodByText(
    methods: PaymentMethodEntity[],
    text: string,
  ): PaymentMethodEntity | undefined {
    const normalized = text.toLowerCase();
    return methods.find((method) => {
      const name = method.name.toLowerCase();
      const digits = method.lastFourDigits ?? '';
      return (
        normalized.includes(name) ||
        (digits.length > 0 && normalized.includes(digits))
      );
    });
  }

  private normalizeDescription(
    parsedDescription: string | undefined,
    fallbackText: string,
  ): string {
    const candidate = (parsedDescription || fallbackText)
      .trim()
      .substring(0, 500);
    if (candidate.length >= 3) {
      return candidate;
    }
    return 'Gasto registrado';
  }

  private reloadBotUpdate(id: string): Promise<BotUpdateDocument | null> {
    return this.botUpdateModel.findById(id).exec();
  }
}
