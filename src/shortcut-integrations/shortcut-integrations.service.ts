import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { hashToken } from '../common/utils/token-hash.util';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { CategoriesService } from '../categories/categories.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ExpenseStatus } from '../expenses/expense.schema';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PaymentMethodKind } from '../payment-methods/payment-method.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BudgetsService } from '../budgets/budgets.service';
import { BoardsService } from '../trips/trips.service';
import { BoardType } from '../trips/board.schema';
import { User, UserDocument } from '../users/user.schema';
import { AdaptiveExpenseParserService } from './adaptive-expense-parser.service';
import { CreateShortcutExpenseDto } from './dto/create-shortcut-expense.dto';
import { CreateShortcutTokenDto } from './dto/create-shortcut-token.dto';
import { ResolveShortcutExpenseDto } from './dto/resolve-shortcut-expense.dto';
import { UpdateShortcutTokenDto } from './dto/update-shortcut-token.dto';
import {
  ShortcutCaptureMode,
  ShortcutIntegrationToken,
  ShortcutIntegrationTokenDocument,
} from './shortcut-integration.schema';

const TOKEN_PREFIX = 'fsa_';
const MAX_ACTIVE_TOKENS = 10;

export interface ShortcutIdentity {
  tokenId: string;
  userId: string;
  name: string;
  mode: ShortcutCaptureMode;
}

type PopulatedPerson = {
  _id?: Types.ObjectId | string;
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class ShortcutIntegrationsService {
  constructor(
    @InjectModel(ShortcutIntegrationToken.name)
    private readonly tokenModel: Model<ShortcutIntegrationTokenDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly boardsService: BoardsService,
    private readonly categoriesService: CategoriesService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly participantsService: ParticipantsService,
    private readonly budgetsService: BudgetsService,
    private readonly expensesService: ExpensesService,
    private readonly adaptiveParser: AdaptiveExpenseParserService,
  ) {}

  async listTokens(userId: string) {
    const tokens = await this.tokenModel
      .find({
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
      })
      .sort({ createdAt: -1 })
      .lean();
    return tokens.map((token) => this.serializeToken(token));
  }

  async createToken(userId: string, dto: CreateShortcutTokenDto) {
    const activeCount = await this.tokenModel.countDocuments({
      userId: new Types.ObjectId(userId),
      revokedAt: { $exists: false },
    });
    if (activeCount >= MAX_ACTIVE_TOKENS) {
      throw new BadRequestException(
        `Podés conectar hasta ${MAX_ACTIVE_TOKENS} dispositivos`,
      );
    }

    const rawToken = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const token = await this.tokenModel.create({
      userId: new Types.ObjectId(userId),
      name: dto.name.trim(),
      tokenHash: hashToken(rawToken),
      tokenPrefix: rawToken.slice(0, 12),
      mode: dto.mode ?? ShortcutCaptureMode.GUIDED,
    });

    return { ...this.serializeToken(token.toObject()), token: rawToken };
  }

  async updateToken(
    userId: string,
    tokenId: string,
    dto: UpdateShortcutTokenDto,
  ) {
    const token = await this.tokenModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(tokenId),
          userId: new Types.ObjectId(userId),
          revokedAt: { $exists: false },
        },
        {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
        },
        { new: true },
      )
      .lean();
    if (!token) throw new NotFoundException('Integración no encontrada');
    return this.serializeToken(token);
  }

  async revokeToken(userId: string, tokenId: string): Promise<void> {
    const result = await this.tokenModel.updateOne(
      {
        _id: new Types.ObjectId(tokenId),
        userId: new Types.ObjectId(userId),
        revokedAt: { $exists: false },
      },
      { revokedAt: new Date() },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException('Integración no encontrada');
    }
  }

  async authenticate(rawToken: string | undefined): Promise<ShortcutIdentity> {
    if (!rawToken || !/^fsa_[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      throw new UnauthorizedException('Token de Atajos inválido');
    }

    const token = await this.tokenModel.findOne({
      tokenHash: hashToken(rawToken),
      revokedAt: { $exists: false },
    });
    if (!token) throw new UnauthorizedException('Token de Atajos inválido');

    await this.tokenModel.updateOne(
      { _id: token._id },
      { lastUsedAt: new Date() },
    );

    return {
      tokenId: token._id.toString(),
      userId: token.userId.toString(),
      name: token.name,
      mode: token.mode,
    };
  }

  async getContext(identity: ShortcutIdentity, requestedBoardId?: string) {
    const boards = await this.boardsService.findAll(identity.userId);
    if (boards.length === 0) {
      throw new BadRequestException('No tenés tableros disponibles');
    }

    const user = await this.userModel
      .findById(identity.userId)
      .select('activeBoardId')
      .lean();
    const selectedBoard = requestedBoardId
      ? boards.find((board) => this.documentId(board) === requestedBoardId)
      : (boards.find(
          (board) =>
            this.documentId(board) === String(user?.activeBoardId ?? ''),
        ) ??
        boards.find((board) => board.type === BoardType.EVERYDAY) ??
        boards[0]);

    if (!selectedBoard) {
      throw new ForbiddenException('No tenés acceso al tablero solicitado');
    }

    const boardId = this.documentId(selectedBoard);
    const [categories, paymentMethods, participants, budgets] =
      await Promise.all([
        this.categoriesService.findAllByBoard(boardId, identity.userId),
        this.paymentMethodsService.findAvailableForBoard(
          boardId,
          identity.userId,
        ),
        selectedBoard.type === BoardType.TRAVEL
          ? this.participantsService.findByTrip(boardId, identity.userId)
          : Promise.resolve([]),
        selectedBoard.type === BoardType.TRAVEL
          ? this.budgetsService.findAllByTrip(boardId, identity.userId)
          : Promise.resolve([]),
      ]);

    return {
      mode: identity.mode,
      integrationName: identity.name,
      selectedBoardId: boardId,
      boards: boards.map((board) => ({
        id: this.documentId(board),
        name: board.name,
        type: board.type,
        currency: board.baseCurrency ?? DEFAULT_CURRENCY,
      })),
      board: {
        id: boardId,
        name: selectedBoard.name,
        type: selectedBoard.type,
        currency: selectedBoard.baseCurrency ?? DEFAULT_CURRENCY,
      },
      categories: categories.map((category) => ({
        id: this.documentId(category),
        name: category.name,
        icon: category.icon,
      })),
      paymentMethods: paymentMethods.map((method) => ({
        id: this.documentId(method),
        name: method.name,
        label: this.paymentMethodLabel(method),
        kind: method.kind,
        institution: method.institution,
        lastFourDigits: method.lastFourDigits,
      })),
      participants: participants.map((participant) => ({
        id: this.documentId(participant),
        name: this.participantName(participant),
        isCurrentUser: this.populatedId(participant.userId) === identity.userId,
      })),
      budgets: budgets.map((budget) => ({
        id: this.documentId(budget),
        name: budget.name,
        currency: budget.currency,
      })),
    };
  }

  async resolveExpense(
    identity: ShortcutIdentity,
    dto: ResolveShortcutExpenseDto,
  ) {
    if (identity.mode !== ShortcutCaptureMode.ADAPTIVE) {
      throw new BadRequestException(
        'Esta integración está configurada en modo guiado',
      );
    }
    const context = await this.getContext(identity, dto.boardId);
    const suggestion = this.adaptiveParser.parse(dto.text, {
      boardCurrency: context.board.currency,
      categories: context.categories.map((category) => ({
        id: category.id,
        name: category.name,
      })),
      paymentMethods: context.paymentMethods.map((method) => ({
        id: method.id,
        name: method.name,
        aliases: [
          method.label,
          method.institution,
          method.lastFourDigits,
          ...method.name.split(/\s+/).filter((part) => part.length >= 3),
          method.kind === PaymentMethodKind.CASH
            ? 'efectivo'
            : method.kind === PaymentMethodKind.DEBIT
              ? 'debito'
              : 'credito',
        ].filter((value): value is string => Boolean(value)),
      })),
    });

    return { suggestion, context };
  }

  async createExpense(
    identity: ShortcutIdentity,
    dto: CreateShortcutExpenseDto,
  ) {
    const context = await this.getContext(identity, dto.boardId);
    const expenseDate = dto.expenseDate ?? new Date().toISOString();
    const currentParticipant = context.participants.find(
      (participant) => participant.isCurrentUser,
    );

    if (context.board.type === BoardType.TRAVEL && !currentParticipant) {
      throw new BadRequestException(
        'No se pudo determinar quién pagó el gasto de viaje',
      );
    }

    const expense = await this.expensesService.create(
      {
        boardId: dto.boardId,
        amount: dto.amount,
        merchantName: dto.merchantName.trim(),
        description: dto.description?.trim() || dto.merchantName.trim(),
        categoryId: dto.categoryId,
        paymentMethodId: dto.paymentMethodId,
        currency: dto.currency ?? context.board.currency,
        budgetId: dto.budgetId,
        expenseDate,
        paymentYearMonth: expenseDate.slice(0, 7),
        paidByParticipantId: currentParticipant?.id,
        isDivisible: false,
        status: ExpenseStatus.PAID,
        clientRequestId: dto.clientRequestId,
      },
      identity.userId,
    );

    return {
      message: 'Gasto registrado desde Atajos',
      expense,
    };
  }

  private serializeToken(token: {
    _id: unknown;
    name: string;
    tokenPrefix: string;
    mode: ShortcutCaptureMode;
    lastUsedAt?: Date;
    createdAt?: Date;
  }) {
    return {
      id: String(token._id),
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      mode: token.mode,
      lastUsedAt: token.lastUsedAt,
      createdAt: token.createdAt,
    };
  }

  private paymentMethodLabel(method: {
    name: string;
    institution?: string;
    lastFourDigits?: string;
  }): string {
    return [
      method.name,
      method.institution,
      method.lastFourDigits ? `•••• ${method.lastFourDigits}` : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  private participantName(participant: {
    guestName?: string;
    userId?: unknown;
  }): string {
    if (participant.guestName) return participant.guestName;
    const user = participant.userId as PopulatedPerson | undefined;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
    return name || 'Participante';
  }

  private populatedId(value: unknown): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'object' && '_id' in value) {
      const id = (value as PopulatedPerson)._id;
      return id instanceof Types.ObjectId ? id.toHexString() : id;
    }
    if (value instanceof Types.ObjectId) return value.toHexString();
    return typeof value === 'string' ? value : undefined;
  }

  private documentId(value: unknown): string {
    return (value as { _id: { toString(): string } })._id.toString();
  }
}
