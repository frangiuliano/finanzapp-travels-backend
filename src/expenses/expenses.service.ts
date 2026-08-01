import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
  SplitType,
  ExpenseSplit,
  PaymentMethod as ExpensePaymentMethod,
} from './expense.schema';
import { Budget, BudgetDocument } from '../budgets/budget.schema';
import {
  Participant,
  ParticipantDocument,
} from '../participants/schemas/participant.schema';
import { BoardType } from '../trips/board.schema';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { resolveCardTypeFromBrand } from '../common/utils/card-type-from-brand';
import { BoardsService } from '../trips/trips.service';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import {
  PaymentMethod as PaymentMethodEntity,
  PaymentMethodKind,
} from '../payment-methods/payment-method.schema';
import { FxService } from '../fx/fx.service';
import { getExpenseAmountInBoardCurrency } from '../common/utils/expense-board-currency';

export interface ExpenseListFilters {
  budgetId?: string;
  status?: ExpenseStatus;
  categoryId?: string;
  paymentMethodId?: string;
  from?: string;
  to?: string;
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
}

interface PopulatedCard {
  _id: Types.ObjectId;
  name: string;
  lastFourDigits: string;
  type?: string;
  brand?: string;
  userId?: PopulatedUser | Types.ObjectId;
}

interface PopulatedExpenseSplit {
  participantId: PopulatedParticipant | Types.ObjectId;
  amount: number;
  percentage?: number;
}

interface PopulatedCategory {
  _id: Types.ObjectId;
  name: string;
  icon?: string;
  color?: string;
  isActive?: boolean;
}

interface PopulatedPaymentMethodEntity {
  _id: Types.ObjectId;
  name: string;
  lastFourDigits?: string;
  brand?: string;
  kind?: PaymentMethodKind;
  ownerType?: string;
  closingDay?: number;
  userId?: PopulatedUser | Types.ObjectId;
  tripId?: Types.ObjectId;
}

interface PopulatedExpense {
  _id: Types.ObjectId;
  tripId: Types.ObjectId;
  budgetId?: PopulatedBudget | Types.ObjectId;
  amount: number;
  currency: string;
  fxRateToBoardCurrency?: number;
  fxCapturedAt?: Date;
  description: string;
  merchantName?: string;
  tags?: string[];
  category?: string;
  categoryId?: PopulatedCategory | Types.ObjectId;
  paidByParticipantId: PopulatedParticipant | Types.ObjectId;
  status: ExpenseStatus;
  paymentMethod?: string;
  cardId?: PopulatedCard | Types.ObjectId;
  paymentMethodId?: PopulatedPaymentMethodEntity | Types.ObjectId;
  isDivisible: boolean;
  splitType?: SplitType;
  splits?: PopulatedExpenseSplit[];
  createdBy: PopulatedUser | Types.ObjectId;
  expenseDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

function isPopulatedUser(
  value: PopulatedUser | Types.ObjectId,
): value is PopulatedUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    'firstName' in value
  );
}

function isPopulatedParticipant(
  value: PopulatedParticipant | Types.ObjectId,
): value is PopulatedParticipant {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    '_id' in value &&
    !('firstName' in value)
  );
}

function isPopulatedBudget(
  value: PopulatedBudget | Types.ObjectId,
): value is PopulatedBudget {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    'name' in value
  );
}

function isPopulatedCard(
  value: PopulatedCard | Types.ObjectId,
): value is PopulatedCard {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    'name' in value &&
    'lastFourDigits' in value
  );
}

function objectIdToString(id: Types.ObjectId | string | undefined): string {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id instanceof Types.ObjectId) return id.toString();
  if (typeof id === 'object' && id !== null && '_id' in id) {
    const innerId = (id as { _id: unknown })._id;
    if (innerId instanceof Types.ObjectId) return innerId.toString();
    if (typeof innerId === 'string') return innerId;
  }
  return String(id);
}

const EXPENSE_RELATION_POPULATES = [
  {
    path: 'paidByParticipantId',
    select: '_id guestName guestEmail',
    populate: {
      path: 'userId',
      select: 'firstName lastName email',
    },
  },
  { path: 'createdBy', select: 'firstName lastName email' },
  { path: 'budgetId', select: '_id name' },
  { path: 'categoryId', select: '_id name icon color isActive' },
  {
    path: 'paymentMethodId',
    select:
      '_id name lastFourDigits brand kind ownerType closingDay userId tripId',
    populate: {
      path: 'userId',
      select: 'firstName lastName',
    },
  },
  {
    path: 'cardId',
    select: '_id name lastFourDigits brand type userId',
    populate: {
      path: 'userId',
      select: 'firstName lastName',
    },
  },
];

function parseExpenseDateFrom(value: string): Date {
  return new Date(value);
}

function parseExpenseDateToExclusive(value: string): Date {
  const endExclusive = new Date(value);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return endExclusive;
}

function isPopulatedCategory(
  value: PopulatedCategory | Types.ObjectId,
): value is PopulatedCategory {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    'name' in value &&
    !('lastFourDigits' in value)
  );
}

function isPopulatedPaymentMethodEntity(
  value: PopulatedPaymentMethodEntity | Types.ObjectId,
): value is PopulatedPaymentMethodEntity {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Types.ObjectId) &&
    'name' in value &&
    ('kind' in value || 'ownerType' in value || 'lastFourDigits' in value)
  );
}

@Injectable()
export class ExpensesService implements OnModuleInit {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    private boardsService: BoardsService,
    private categoriesService: CategoriesService,
    private paymentMethodsService: PaymentMethodsService,
    private fxService: FxService,
  ) {}

  async onModuleInit(): Promise<void> {
    const legacyExpenses = await this.expenseModel
      .find({
        cardId: { $exists: true, $ne: null },
        paymentMethodId: { $exists: false },
      })
      .select('_id cardId')
      .lean();

    if (legacyExpenses.length === 0) {
      return;
    }

    for (const expense of legacyExpenses) {
      await this.expenseModel.updateOne(
        { _id: expense._id },
        { $set: { paymentMethodId: expense.cardId } },
      );
    }

    this.logger.log(
      `Backfilled paymentMethodId on ${legacyExpenses.length} legacy expenses`,
    );
  }

  async create(
    createExpenseDto: CreateExpenseDto,
    userId: string,
  ): Promise<Expense> {
    const clientRequestId = createExpenseDto.clientRequestId;

    if (clientRequestId) {
      const existing = await this.findExistingByClientRequestId(
        clientRequestId,
        userId,
      );
      if (existing) {
        this.logger.log(
          `Idempotent replay for clientRequestId=${clientRequestId} (user ${userId})`,
        );
        return existing;
      }
    }

    const boardId = resolveBoardId(createExpenseDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    const board = await this.boardsService.findByIdOrFail(boardId);

    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(boardId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este tablero o el tablero no existe',
      );
    }

    let budget: BudgetDocument | null = null;
    if (createExpenseDto.budgetId) {
      if (board.type !== BoardType.TRAVEL) {
        throw new BadRequestException(
          'Los presupuestos de viaje solo aplican a tableros travel',
        );
      }

      budget = await this.budgetModel.findById(createExpenseDto.budgetId);

      if (!budget) {
        throw new NotFoundException('Presupuesto no encontrado');
      }

      if (budget.tripId.toString() !== boardId) {
        throw new BadRequestException(
          'El presupuesto no pertenece a este tablero',
        );
      }
    }

    const paidByParticipantId =
      createExpenseDto.paidByParticipantId || userParticipant._id.toString();

    if (
      board.type === BoardType.TRAVEL &&
      !createExpenseDto.paidByParticipantId
    ) {
      throw new BadRequestException(
        'El ID del participante que pagó es obligatorio en tableros travel',
      );
    }

    const paidByParticipant = await this.participantModel.findOne({
      _id: new Types.ObjectId(paidByParticipantId),
      tripId: new Types.ObjectId(boardId),
    });

    if (!paidByParticipant) {
      throw new NotFoundException(
        'El participante que pagó no existe o no pertenece a este tablero',
      );
    }

    if (
      board.type !== BoardType.TRAVEL &&
      createExpenseDto.status === ExpenseStatus.PENDING
    ) {
      throw new BadRequestException(
        'El estado pending solo está disponible en tableros travel',
      );
    }

    const status = createExpenseDto.status || ExpenseStatus.PAID;

    const isDivisible = createExpenseDto.isDivisible ?? false;

    if (isDivisible && board.type !== BoardType.TRAVEL) {
      throw new BadRequestException(
        'Los splits solo están disponibles en tableros travel',
      );
    }

    if (isDivisible) {
      if (!createExpenseDto.splitType || !createExpenseDto.splits) {
        throw new BadRequestException(
          'Si el gasto es divisible, debe especificar el tipo de división y las divisiones',
        );
      }

      if (createExpenseDto.splits.length === 0) {
        throw new BadRequestException(
          'Si el gasto es divisible, debe incluir al menos un participante',
        );
      }
    } else {
      if (createExpenseDto.splits && createExpenseDto.splits.length > 0) {
        throw new BadRequestException(
          'Un gasto no divisible no debe tener divisiones',
        );
      }
    }

    const tripParticipants = await this.participantModel.find({
      tripId: new Types.ObjectId(boardId),
    });

    let processedSplits: ExpenseSplit[] | undefined;

    if (isDivisible && createExpenseDto.splits) {
      if (createExpenseDto.splitType === SplitType.EQUAL) {
        const selectedParticipantIds = createExpenseDto.splits.map(
          (s) => new Types.ObjectId(s.participantId),
        );
        const amountPerParticipant =
          createExpenseDto.amount / selectedParticipantIds.length;

        processedSplits = selectedParticipantIds.map((participantId) => ({
          participantId,
          amount: Number(amountPerParticipant.toFixed(2)),
          percentage: Number((100 / selectedParticipantIds.length).toFixed(2)),
        }));

        const totalCalculated = processedSplits.reduce(
          (sum, split) => sum + split.amount,
          0,
        );
        const difference = createExpenseDto.amount - totalCalculated;
        if (Math.abs(difference) > 0.01) {
          processedSplits[processedSplits.length - 1].amount = Number(
            (
              processedSplits[processedSplits.length - 1].amount + difference
            ).toFixed(2),
          );
        }
      } else {
        processedSplits = createExpenseDto.splits.map((split) => ({
          participantId: new Types.ObjectId(split.participantId),
          amount: split.amount,
          percentage: split.percentage,
        }));
      }

      const splitParticipantIds = processedSplits.map((s) => s.participantId);
      const validParticipantIds = tripParticipants.map((p) => p._id);

      for (const participantId of splitParticipantIds) {
        if (!validParticipantIds.some((id) => id.equals(participantId))) {
          throw new BadRequestException(
            `El participante ${participantId.toString()} no pertenece a este tablero`,
          );
        }
      }

      const totalSplits = processedSplits.reduce(
        (sum, split) => sum + split.amount,
        0,
      );
      if (Math.abs(totalSplits - createExpenseDto.amount) > 0.01) {
        throw new BadRequestException(
          'La suma de las divisiones debe ser igual al monto total del gasto',
        );
      }
    }

    const expenseDate = createExpenseDto.expenseDate
      ? new Date(createExpenseDto.expenseDate)
      : new Date();

    if (createExpenseDto.categoryId) {
      await this.assertCategoryBelongsToBoard(
        boardId,
        createExpenseDto.categoryId,
        userId,
      );
    }

    const resolvedPaymentMethodId =
      this.resolvePaymentMethodId(createExpenseDto);
    let legacyPaymentMethod =
      createExpenseDto.paymentMethod || ExpensePaymentMethod.CASH;
    let paymentMethodObjectId: Types.ObjectId | undefined;

    if (resolvedPaymentMethodId) {
      const method = await this.assertPaymentMethodAvailableForBoard(
        boardId,
        userId,
        resolvedPaymentMethodId,
      );
      paymentMethodObjectId = new Types.ObjectId(resolvedPaymentMethodId);
      legacyPaymentMethod = this.mapKindToLegacyPaymentMethod(method.kind);
    }

    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const expenseCurrency =
      createExpenseDto.currency ?? boardCurrency ?? DEFAULT_CURRENCY;

    const fxSnapshot = await this.fxService.resolveSnapshot(
      expenseCurrency,
      boardCurrency,
      createExpenseDto.fxRateOverride,
    );

    const expense = new this.expenseModel({
      tripId: new Types.ObjectId(boardId),
      budgetId: createExpenseDto.budgetId
        ? new Types.ObjectId(createExpenseDto.budgetId)
        : undefined,
      amount: createExpenseDto.amount,
      currency: expenseCurrency,
      fxRateToBoardCurrency: fxSnapshot.fxRateToBoardCurrency,
      fxCapturedAt: fxSnapshot.fxCapturedAt,
      description: createExpenseDto.description,
      merchantName: createExpenseDto.merchantName,
      tags: createExpenseDto.tags,
      category: createExpenseDto.category,
      categoryId: createExpenseDto.categoryId
        ? new Types.ObjectId(createExpenseDto.categoryId)
        : undefined,
      paidByParticipantId: new Types.ObjectId(paidByParticipantId),
      paymentMethod: legacyPaymentMethod,
      cardId: paymentMethodObjectId,
      paymentMethodId: paymentMethodObjectId,
      isDivisible,
      splitType: isDivisible ? createExpenseDto.splitType : undefined,
      splits: processedSplits,
      status,
      createdBy: new Types.ObjectId(userId),
      clientRequestId,
      expenseDate,
    });

    let savedExpense: ExpenseDocument;
    try {
      savedExpense = await expense.save();
    } catch (error) {
      if (clientRequestId && this.isDuplicateKeyError(error)) {
        const existing = await this.findExistingByClientRequestId(
          clientRequestId,
          userId,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    if (createExpenseDto.budgetId) {
      const amountForBudget = this.getBudgetAmountForExpense(
        savedExpense,
        boardCurrency,
      );
      await this.updateBudgetSpent(createExpenseDto.budgetId, amountForBudget);
    }

    this.logger.log(
      `Gasto creado: ${savedExpense.description} (${savedExpense.amount} ${savedExpense.currency}) en el tablero ${boardId}`,
    );

    const populatedExpense = await this.expenseModel
      .findById(savedExpense._id)
      .populate(EXPENSE_RELATION_POPULATES)
      .lean();

    return this.transformExpense(populatedExpense);
  }

  async findAll(
    tripId: string,
    userId: string,
    filters: ExpenseListFilters = {},
  ): Promise<Expense[]> {
    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este viaje o el viaje no existe',
      );
    }

    const query: {
      tripId: Types.ObjectId;
      budgetId?: Types.ObjectId;
      status?: ExpenseStatus;
      categoryId?: Types.ObjectId;
      $or?: Array<
        { paymentMethodId: Types.ObjectId } | { cardId: Types.ObjectId }
      >;
      expenseDate?: {
        $gte?: Date;
        $lt?: Date;
      };
    } = { tripId: new Types.ObjectId(tripId) };

    if (filters.budgetId) {
      query.budgetId = new Types.ObjectId(filters.budgetId);
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.categoryId) {
      query.categoryId = new Types.ObjectId(filters.categoryId);
    }

    if (filters.paymentMethodId) {
      const paymentMethodObjectId = new Types.ObjectId(filters.paymentMethodId);
      query.$or = [
        { paymentMethodId: paymentMethodObjectId },
        { cardId: paymentMethodObjectId },
      ];
    }

    if (filters.from || filters.to) {
      query.expenseDate = {};
      if (filters.from) {
        query.expenseDate.$gte = parseExpenseDateFrom(filters.from);
      }
      if (filters.to) {
        query.expenseDate.$lt = parseExpenseDateToExclusive(filters.to);
      }
    }

    const expenses = await this.expenseModel
      .find(query)
      .populate(EXPENSE_RELATION_POPULATES)
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean();

    return this.transformExpenses(expenses);
  }

  async findOne(id: string, userId: string): Promise<Expense> {
    const expense = await this.expenseModel
      .findById(id)
      .populate(EXPENSE_RELATION_POPULATES)
      .populate({
        path: 'splits.participantId',
        select: '_id guestName guestEmail',
        populate: {
          path: 'userId',
          select: 'firstName lastName email',
        },
      })
      .lean();

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    const userParticipant = await this.participantModel.findOne({
      tripId: expense.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este gasto o el viaje no existe',
      );
    }

    return this.transformExpense(expense);
  }

  async update(
    id: string,
    updateExpenseDto: UpdateExpenseDto,
    userId: string,
  ): Promise<Expense> {
    const expense = await this.expenseModel.findById(id);

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    const board = await this.boardsService.findByIdOrFail(
      expense.tripId.toString(),
    );

    if (board.type !== BoardType.TRAVEL) {
      if (updateExpenseDto.budgetId) {
        throw new BadRequestException(
          'Los presupuestos de viaje solo aplican a tableros travel',
        );
      }
      if (
        updateExpenseDto.isDivisible ||
        (updateExpenseDto.splits && updateExpenseDto.splits.length > 0)
      ) {
        throw new BadRequestException(
          'Los splits solo están disponibles en tableros travel',
        );
      }
      if (
        updateExpenseDto.status !== undefined &&
        updateExpenseDto.status !== expense.status
      ) {
        throw new BadRequestException(
          'Cambiar el estado de un gasto (settle/pending) solo está disponible en tableros travel',
        );
      }
    }

    const userParticipant = await this.participantModel.findOne({
      tripId: expense.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este gasto o el tablero no existe',
      );
    }

    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const oldAmountForBudget = this.getBudgetAmountForExpense(
      expense,
      boardCurrency,
    );

    if (updateExpenseDto.budgetId) {
      const budget = await this.budgetModel.findById(updateExpenseDto.budgetId);
      if (!budget) {
        throw new NotFoundException('Presupuesto no encontrado');
      }
      if (budget.tripId.toString() !== expense.tripId.toString()) {
        throw new BadRequestException(
          'El presupuesto no pertenece a este tablero',
        );
      }
    }

    if (updateExpenseDto.paidByParticipantId) {
      const paidByParticipant = await this.participantModel.findOne({
        _id: new Types.ObjectId(updateExpenseDto.paidByParticipantId),
        tripId: expense.tripId,
      });

      if (!paidByParticipant) {
        throw new NotFoundException(
          'El participante que pagó no existe o no pertenece a este viaje',
        );
      }
    }

    const boardIdStr = expense.tripId.toString();

    if (updateExpenseDto.categoryId) {
      await this.assertCategoryBelongsToBoard(
        boardIdStr,
        updateExpenseDto.categoryId,
        userId,
      );
    }

    const resolvedUpdatePaymentMethodId =
      this.resolvePaymentMethodId(updateExpenseDto);
    let updatedPaymentMethodObjectId =
      expense.paymentMethodId ?? expense.cardId;
    let updatedLegacyPaymentMethod = expense.paymentMethod;

    if (
      updateExpenseDto.paymentMethodId !== undefined ||
      updateExpenseDto.cardId !== undefined
    ) {
      if (resolvedUpdatePaymentMethodId) {
        const method = await this.assertPaymentMethodAvailableForBoard(
          boardIdStr,
          userId,
          resolvedUpdatePaymentMethodId,
        );
        updatedPaymentMethodObjectId = new Types.ObjectId(
          resolvedUpdatePaymentMethodId,
        );
        updatedLegacyPaymentMethod = this.mapKindToLegacyPaymentMethod(
          method.kind,
        );
      } else {
        updatedPaymentMethodObjectId = undefined;
        updatedLegacyPaymentMethod = ExpensePaymentMethod.CASH;
      }
    } else if (updateExpenseDto.paymentMethod !== undefined) {
      updatedLegacyPaymentMethod = updateExpenseDto.paymentMethod;
    }

    const isDivisible =
      updateExpenseDto.isDivisible !== undefined
        ? updateExpenseDto.isDivisible
        : expense.isDivisible;

    const newAmount = updateExpenseDto.amount || expense.amount;
    let processedSplits: ExpenseSplit[] | undefined = expense.splits;

    const isChangingDivisibility = expense.isDivisible !== isDivisible;
    const isUpdatingSplits =
      updateExpenseDto.splits !== undefined ||
      updateExpenseDto.splitType !== undefined;

    if (isDivisible) {
      if (isChangingDivisibility || isUpdatingSplits) {
        if (
          !updateExpenseDto.splitType ||
          !updateExpenseDto.splits ||
          updateExpenseDto.splits.length === 0
        ) {
          throw new BadRequestException(
            'Si el gasto es divisible, debe especificar el tipo de división y las divisiones con al menos un participante',
          );
        }

        const splitType =
          updateExpenseDto.splitType || expense.splitType || SplitType.EQUAL;
        const tripParticipants = await this.participantModel.find({
          tripId: expense.tripId,
        });

        if (splitType === SplitType.EQUAL) {
          const selectedParticipantIds = updateExpenseDto.splits.map(
            (s) => new Types.ObjectId(s.participantId),
          );
          const amountPerParticipant =
            newAmount / selectedParticipantIds.length;

          processedSplits = selectedParticipantIds.map((participantId) => ({
            participantId,
            amount: Number(amountPerParticipant.toFixed(2)),
            percentage: Number(
              (100 / selectedParticipantIds.length).toFixed(2),
            ),
          }));

          const totalCalculated = processedSplits.reduce(
            (sum, split) => sum + split.amount,
            0,
          );
          const difference = newAmount - totalCalculated;
          if (Math.abs(difference) > 0.01) {
            processedSplits[processedSplits.length - 1].amount = Number(
              (
                processedSplits[processedSplits.length - 1].amount + difference
              ).toFixed(2),
            );
          }
        } else {
          processedSplits = updateExpenseDto.splits.map((split) => ({
            participantId: new Types.ObjectId(split.participantId),
            amount: split.amount,
            percentage: split.percentage,
          }));

          const totalSplits = processedSplits.reduce(
            (sum, split) => sum + split.amount,
            0,
          );
          if (Math.abs(totalSplits - newAmount) > 0.01) {
            throw new BadRequestException(
              'La suma de las divisiones debe ser igual al monto total del gasto',
            );
          }
        }

        const splitParticipantIds = processedSplits.map((s) => s.participantId);
        const validParticipantIds = tripParticipants.map((p) => p._id);

        for (const participantId of splitParticipantIds) {
          if (!validParticipantIds.some((id) => id.equals(participantId))) {
            throw new BadRequestException(
              `El participante ${participantId.toString()} no pertenece a este viaje`,
            );
          }
        }
      } else {
        if (!expense.splits || expense.splits.length === 0) {
          throw new BadRequestException(
            'Un gasto divisible debe tener divisiones',
          );
        }
        if (updateExpenseDto.amount !== undefined) {
          const oldAmount = expense.amount;
          const ratio = newAmount / oldAmount;
          processedSplits = expense.splits.map((split) => ({
            ...split,
            amount: Number((split.amount * ratio).toFixed(2)),
          }));
        } else {
          processedSplits = expense.splits;
        }
      }
    } else {
      if (
        updateExpenseDto.splits !== undefined &&
        updateExpenseDto.splits.length > 0
      ) {
        throw new BadRequestException(
          'Un gasto no divisible no debe tener divisiones',
        );
      }
      processedSplits = undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tripId: _, boardId: __, ...updateFields } = updateExpenseDto;

    Object.assign(expense, {
      ...updateFields,
      budgetId:
        updateExpenseDto.budgetId !== undefined
          ? updateExpenseDto.budgetId
            ? new Types.ObjectId(updateExpenseDto.budgetId)
            : undefined
          : expense.budgetId,
      paidByParticipantId: updateExpenseDto.paidByParticipantId
        ? new Types.ObjectId(updateExpenseDto.paidByParticipantId)
        : expense.paidByParticipantId,
      categoryId:
        updateExpenseDto.categoryId !== undefined
          ? updateExpenseDto.categoryId
            ? new Types.ObjectId(updateExpenseDto.categoryId)
            : undefined
          : expense.categoryId,
      paymentMethod: updatedLegacyPaymentMethod,
      cardId: updatedPaymentMethodObjectId,
      paymentMethodId: updatedPaymentMethodObjectId,
      isDivisible,
      splitType: isDivisible
        ? updateExpenseDto.splitType || expense.splitType
        : undefined,
      splits: processedSplits,
      expenseDate: updateExpenseDto.expenseDate
        ? new Date(updateExpenseDto.expenseDate)
        : expense.expenseDate,
    });

    expense.updatedAt = new Date();
    const updatedExpense = await expense.save();

    if (
      updateExpenseDto.amount !== undefined ||
      updateExpenseDto.budgetId !== undefined
    ) {
      if (expense.budgetId) {
        await this.updateBudgetSpent(
          expense.budgetId.toString(),
          -oldAmountForBudget,
        );
      }

      if (updatedExpense.budgetId) {
        const newAmountForBudget = this.getBudgetAmountForExpense(
          updatedExpense,
          boardCurrency,
        );
        await this.updateBudgetSpent(
          updatedExpense.budgetId.toString(),
          newAmountForBudget,
        );
      }
    }

    this.logger.log(`Gasto actualizado: ${id}`);

    const populatedExpense = await this.expenseModel
      .findById(updatedExpense._id)
      .populate(EXPENSE_RELATION_POPULATES)
      .populate({
        path: 'splits.participantId',
        select: '_id guestName guestEmail',
        populate: {
          path: 'userId',
          select: 'firstName lastName email',
        },
      })
      .lean();

    return this.transformExpense(populatedExpense);
  }

  async remove(id: string, userId: string): Promise<void> {
    const expense = await this.expenseModel.findById(id);

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    const userParticipant = await this.participantModel.findOne({
      tripId: expense.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este gasto o el viaje no existe',
      );
    }

    const board = await this.boardsService.findByIdOrFail(
      expense.tripId.toString(),
    );
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const amountForBudget = this.getBudgetAmountForExpense(
      expense,
      boardCurrency,
    );

    await this.expenseModel.findByIdAndDelete(id);

    if (expense.budgetId) {
      const budgetId = expense.budgetId.toString();
      await this.updateBudgetSpent(budgetId, -amountForBudget);
    }

    this.logger.log(`Gasto eliminado: ${id}`);
  }

  async getTripExpenseSummary(
    tripId: string,
    userId: string,
  ): Promise<{
    totalExpenses: number;
    totalByBudget: Array<{
      budgetId: string;
      budgetName: string;
      total: number;
    }>;
    totalByStatus: { paid: number; pending: number };
    totalByParticipant: Array<{
      participantId: string;
      participantName: string;
      totalPaid: number;
      totalOwed: number;
      balance: number;
    }>;
  }> {
    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este tablero o el tablero no existe',
      );
    }

    const isTravel = await this.boardsService.isTravelBoard(tripId);

    const expenses = await this.expenseModel
      .find({ tripId: new Types.ObjectId(tripId) })
      .populate('budgetId', 'name')
      .populate('paidByParticipantId', 'userId guestName')
      .lean();

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    const budgetMap = new Map<string, { name: string; total: number }>();
    expenses.forEach((exp) => {
      if (!exp.budgetId) {
        const current = budgetMap.get('sin-presupuesto') || {
          name: 'Sin presupuesto',
          total: 0,
        };
        current.total += exp.amount;
        budgetMap.set('sin-presupuesto', current);
        return;
      }

      const budgetIdObj = exp.budgetId as
        | Types.ObjectId
        | { _id: Types.ObjectId; name: string };

      if (
        budgetIdObj &&
        typeof budgetIdObj === 'object' &&
        'name' in budgetIdObj &&
        '_id' in budgetIdObj
      ) {
        const populatedBudget = budgetIdObj as {
          _id: Types.ObjectId;
          name: string;
        };
        const budgetId = populatedBudget._id.toString();
        const budgetName = populatedBudget.name || 'Sin nombre';
        const current = budgetMap.get(budgetId) || {
          name: budgetName,
          total: 0,
        };
        current.total += exp.amount;
        budgetMap.set(budgetId, current);
      } else if (budgetIdObj) {
        const budgetId = budgetIdObj.toString();
        const current = budgetMap.get(budgetId) || {
          name: 'Sin nombre',
          total: 0,
        };
        current.total += exp.amount;
        budgetMap.set(budgetId, current);
      }
    });

    const totalByBudget = Array.from(budgetMap.entries()).map(([id, data]) => ({
      budgetId: id,
      budgetName: data.name,
      total: data.total,
    }));

    const totalByStatus = expenses.reduce(
      (acc, exp) => {
        if (exp.status === ExpenseStatus.PAID) {
          acc.paid += exp.amount;
        } else {
          acc.pending += exp.amount;
        }
        return acc;
      },
      { paid: 0, pending: 0 },
    );

    if (!isTravel) {
      return {
        totalExpenses,
        totalByBudget,
        totalByStatus,
        totalByParticipant: [],
      };
    }

    const participantMap = new Map<
      string,
      { name: string; paid: number; owed: number }
    >();

    const participants = await this.participantModel
      .find({
        tripId: new Types.ObjectId(tripId),
      })
      .populate('userId', 'firstName lastName email')
      .lean();

    participants.forEach((p) => {
      const participantId = p._id.toString();
      const userIdObj = p.userId as
        | Types.ObjectId
        | {
            _id: Types.ObjectId;
            firstName: string;
            lastName: string;
            email: string;
          };
      let name = p.guestName || 'Sin nombre';
      if (
        !p.guestName &&
        userIdObj &&
        typeof userIdObj === 'object' &&
        'firstName' in userIdObj &&
        'lastName' in userIdObj
      ) {
        const user = userIdObj as {
          firstName: string;
          lastName: string;
        };
        name =
          `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
          'Sin nombre';
      }
      participantMap.set(participantId, { name, paid: 0, owed: 0 });
    });

    expenses.forEach((exp) => {
      if (exp.paidByParticipantId) {
        const paidByObj = exp.paidByParticipantId as
          | Types.ObjectId
          | { _id: Types.ObjectId; userId?: unknown; guestName?: string };
        const payerId =
          paidByObj && typeof paidByObj === 'object' && '_id' in paidByObj
            ? paidByObj._id.toString()
            : (paidByObj as Types.ObjectId).toString();
        const participant = participantMap.get(payerId);
        if (participant) {
          participant.paid += exp.amount;
        }
      }

      if (exp.splits && exp.splits.length > 0) {
        exp.splits.forEach((split) => {
          const participantId = split.participantId.toString();
          const participant = participantMap.get(participantId);
          if (participant) {
            participant.owed += split.amount;
          }
        });
      }
    });

    const totalByParticipant = Array.from(participantMap.entries()).map(
      ([id, data]) => ({
        participantId: id,
        participantName: data.name,
        totalPaid: data.paid,
        totalOwed: data.owed,
        balance: data.paid - data.owed,
      }),
    );

    return {
      totalExpenses,
      totalByBudget,
      totalByStatus,
      totalByParticipant,
    };
  }

  async getParticipantBalance(
    participantId: string,
    tripId: string,
    userId: string,
  ): Promise<{
    participantId: string;
    participantName: string;
    totalPaid: number;
    totalOwed: number;
    balance: number;
  }> {
    await this.boardsService.assertTravelFeatures(tripId);

    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este tablero o el tablero no existe',
      );
    }

    const participant = await this.participantModel
      .findOne({
        _id: new Types.ObjectId(participantId),
        tripId: new Types.ObjectId(tripId),
      })
      .populate('userId', 'firstName lastName email')
      .lean();

    if (!participant) {
      throw new NotFoundException(
        'Participante no encontrado o no pertenece a este viaje',
      );
    }

    const expenses = await this.expenseModel
      .find({ tripId: new Types.ObjectId(tripId) })
      .populate('paidByParticipantId', '_id')
      .lean();

    let totalPaid = 0;
    let totalOwed = 0;

    expenses.forEach((exp) => {
      if (exp.paidByParticipantId) {
        const paidByObj = exp.paidByParticipantId as
          | Types.ObjectId
          | { _id: Types.ObjectId };
        const payerId =
          paidByObj && typeof paidByObj === 'object' && '_id' in paidByObj
            ? paidByObj._id.toString()
            : (paidByObj as Types.ObjectId).toString();
        if (payerId === participantId) {
          totalPaid += exp.amount;
        }
      }

      if (exp.splits && exp.splits.length > 0) {
        exp.splits.forEach((split) => {
          if (split.participantId.toString() === participantId) {
            totalOwed += split.amount;
          }
        });
      }
    });

    const userIdObj = participant.userId as
      | Types.ObjectId
      | {
          _id: Types.ObjectId;
          firstName: string;
          lastName: string;
          email: string;
        };
    let participantName = participant.guestName || 'Sin nombre';
    if (
      !participant.guestName &&
      userIdObj &&
      typeof userIdObj === 'object' &&
      'firstName' in userIdObj &&
      'lastName' in userIdObj
    ) {
      const user = userIdObj as {
        firstName: string;
        lastName: string;
      };
      participantName =
        `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Sin nombre';
    }

    return {
      participantId,
      participantName,
      totalPaid,
      totalOwed,
      balance: totalPaid - totalOwed,
    };
  }

  async getParticipantDebts(
    tripId: string,
    userId: string,
  ): Promise<{
    debts: Array<{
      fromParticipantId: string;
      fromParticipantName: string;
      toParticipantId: string;
      toParticipantName: string;
      amount: number;
    }>;
  }> {
    await this.boardsService.assertTravelFeatures(tripId);

    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este tablero o el tablero no existe',
      );
    }

    const expenses = await this.expenseModel
      .find({
        tripId: new Types.ObjectId(tripId),
        status: ExpenseStatus.PENDING,
      })
      .populate('paidByParticipantId', '_id guestName')
      .populate('splits.participantId', '_id guestName')
      .lean();

    const participants = await this.participantModel
      .find({
        tripId: new Types.ObjectId(tripId),
      })
      .populate('userId', 'firstName lastName email')
      .lean();

    const participantMap = new Map<string, string>();
    participants.forEach((p) => {
      const participantId = p._id.toString();
      const userIdObj = p.userId as
        | Types.ObjectId
        | {
            _id: Types.ObjectId;
            firstName: string;
            lastName: string;
            email: string;
          };
      let name = p.guestName || 'Sin nombre';
      if (
        !p.guestName &&
        userIdObj &&
        typeof userIdObj === 'object' &&
        'firstName' in userIdObj &&
        'lastName' in userIdObj
      ) {
        const user = userIdObj as {
          firstName: string;
          lastName: string;
        };
        name =
          `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
          'Sin nombre';
      }
      participantMap.set(participantId, name);
    });

    const debtMap = new Map<string, Map<string, number>>();

    expenses.forEach((exp) => {
      if (!exp.paidByParticipantId) return;

      const paidByObj = exp.paidByParticipantId as
        | Types.ObjectId
        | { _id: Types.ObjectId; userId?: unknown; guestName?: string };
      const payerId =
        paidByObj && typeof paidByObj === 'object' && '_id' in paidByObj
          ? paidByObj._id.toString()
          : (paidByObj as Types.ObjectId).toString();

      if (exp.splits && exp.splits.length > 0) {
        exp.splits.forEach((split) => {
          const splitParticipantId = isPopulatedParticipant(split.participantId)
            ? objectIdToString(split.participantId._id)
            : objectIdToString(split.participantId);

          if (splitParticipantId !== payerId) {
            if (!debtMap.has(splitParticipantId)) {
              debtMap.set(splitParticipantId, new Map<string, number>());
            }
            const debtorDebts = debtMap.get(splitParticipantId)!;
            const currentDebt = debtorDebts.get(payerId) || 0;
            debtorDebts.set(payerId, currentDebt + split.amount);
          }
        });
      }
    });

    const debts: Array<{
      fromParticipantId: string;
      fromParticipantName: string;
      toParticipantId: string;
      toParticipantName: string;
      amount: number;
    }> = [];

    debtMap.forEach((debtorDebts, fromParticipantId) => {
      const fromParticipantName =
        participantMap.get(fromParticipantId) || 'Sin nombre';
      debtorDebts.forEach((amount, toParticipantId) => {
        const toParticipantName =
          participantMap.get(toParticipantId) || 'Sin nombre';
        debts.push({
          fromParticipantId,
          fromParticipantName,
          toParticipantId,
          toParticipantName,
          amount,
        });
      });
    });

    return { debts };
  }

  async settleExpense(id: string, userId: string): Promise<Expense> {
    const expense = await this.expenseModel.findById(id);

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    await this.boardsService.assertTravelFeatures(expense.tripId.toString());

    if (expense.status === ExpenseStatus.PAID) {
      throw new BadRequestException('Este gasto ya está marcado como pagado');
    }

    const userParticipant = await this.participantModel.findOne({
      tripId: expense.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este gasto o el tablero no existe',
      );
    }

    expense.status = ExpenseStatus.PAID;
    expense.updatedAt = new Date();
    const updatedExpense = await expense.save();

    this.logger.log(`Gasto marcado como saldado: ${id}`);

    const populatedExpense = await this.expenseModel
      .findById(updatedExpense._id)
      .populate(EXPENSE_RELATION_POPULATES)
      .populate({
        path: 'splits.participantId',
        select: '_id guestName guestEmail',
        populate: {
          path: 'userId',
          select: 'firstName lastName email',
        },
      })
      .lean();

    return this.transformExpense(populatedExpense);
  }

  private transformExpense(expense: unknown): Expense {
    if (!expense) return expense as Expense;

    const expenseRecord = expense as PopulatedExpense;
    const transformed: Record<string, unknown> = {
      ...expenseRecord,
    };

    transformed._id = objectIdToString(expenseRecord._id);
    transformed.tripId = objectIdToString(expenseRecord.tripId);
    transformed.boardId = objectIdToString(expenseRecord.tripId);

    if (expenseRecord.budgetId) {
      if (isPopulatedBudget(expenseRecord.budgetId)) {
        transformed.budget = {
          _id: objectIdToString(expenseRecord.budgetId._id),
          name: expenseRecord.budgetId.name,
        };
        transformed.budgetId = objectIdToString(expenseRecord.budgetId._id);
      } else {
        transformed.budgetId = objectIdToString(expenseRecord.budgetId);
      }
    }

    if (expenseRecord.categoryId) {
      if (isPopulatedCategory(expenseRecord.categoryId)) {
        const category = expenseRecord.categoryId;
        transformed.category = {
          _id: objectIdToString(category._id),
          name: category.name,
          icon: category.icon,
          color: category.color,
          isActive: category.isActive,
        };
        transformed.categoryId = objectIdToString(category._id);
      } else {
        transformed.categoryId = objectIdToString(expenseRecord.categoryId);
      }
    }

    if (isPopulatedUser(expenseRecord.createdBy)) {
      transformed.createdBy = {
        _id: objectIdToString(expenseRecord.createdBy._id),
        firstName: expenseRecord.createdBy.firstName,
        lastName: expenseRecord.createdBy.lastName,
        email: expenseRecord.createdBy.email,
      };
    } else {
      transformed.createdBy = {
        _id: objectIdToString(expenseRecord.createdBy),
        firstName: '',
        lastName: '',
      };
    }

    if (expenseRecord.paidByParticipantId) {
      if (isPopulatedParticipant(expenseRecord.paidByParticipantId)) {
        const participant = expenseRecord.paidByParticipantId;
        const participantData: {
          _id: string;
          userId?:
            | {
                _id: string;
                firstName: string;
                lastName: string;
                email?: string;
              }
            | string;
          guestName?: string;
          guestEmail?: string;
        } = {
          _id: objectIdToString(participant._id),
        };

        if (participant.userId) {
          if (isPopulatedUser(participant.userId)) {
            participantData.userId = {
              _id: objectIdToString(participant.userId._id),
              firstName: participant.userId.firstName,
              lastName: participant.userId.lastName,
              email: participant.userId.email,
            };
          } else {
            participantData.userId = objectIdToString(participant.userId);
          }
        }

        if (participant.guestName) {
          participantData.guestName = participant.guestName;
        }

        if (participant.guestEmail) {
          participantData.guestEmail = participant.guestEmail;
        }

        transformed.paidByParticipant = participantData;
        transformed.paidByParticipantId = objectIdToString(participant._id);
      } else {
        transformed.paidByParticipantId = objectIdToString(
          expenseRecord.paidByParticipantId,
        );
      }
    }

    const paymentMethodSource =
      expenseRecord.paymentMethodId ?? expenseRecord.cardId;

    if (paymentMethodSource) {
      if (isPopulatedPaymentMethodEntity(paymentMethodSource)) {
        const method = paymentMethodSource;
        const methodData = {
          _id: objectIdToString(method._id),
          name: method.name,
          lastFourDigits: method.lastFourDigits,
          kind: method.kind,
          ownerType: method.ownerType,
          closingDay: method.closingDay,
          brand: method.brand,
          type: resolveCardTypeFromBrand(method.brand, method.kind),
          user:
            method.userId && isPopulatedUser(method.userId)
              ? {
                  _id: objectIdToString(method.userId._id),
                  firstName: method.userId.firstName,
                  lastName: method.userId.lastName,
                }
              : undefined,
        };

        transformed.paymentMethodDetail = methodData;
        transformed.paymentMethodId = objectIdToString(method._id);
        transformed.card = methodData;
        transformed.cardId = objectIdToString(method._id);
      } else if (isPopulatedCard(paymentMethodSource)) {
        const card = paymentMethodSource;
        const cardData: {
          _id: string;
          name: string;
          lastFourDigits: string;
          type: string;
          user?: {
            _id: string;
            firstName: string;
            lastName: string;
          };
        } = {
          _id: objectIdToString(card._id),
          name: card.name,
          lastFourDigits: card.lastFourDigits,
          type: resolveCardTypeFromBrand(card.brand, card.type),
        };

        if (card.userId) {
          if (isPopulatedUser(card.userId)) {
            cardData.user = {
              _id: objectIdToString(card.userId._id),
              firstName: card.userId.firstName,
              lastName: card.userId.lastName,
            };
          }
        }

        transformed.paymentMethodDetail = cardData;
        transformed.paymentMethodId = objectIdToString(card._id);
        transformed.card = cardData;
        transformed.cardId = objectIdToString(card._id);
      } else {
        const idStr = objectIdToString(paymentMethodSource);
        transformed.paymentMethodId = idStr;
        transformed.cardId = idStr;
      }
    }

    if (expenseRecord.splits && Array.isArray(expenseRecord.splits)) {
      transformed.splits = expenseRecord.splits.map((split) => {
        const splitData: {
          participantId: string;
          amount: number;
          percentage?: number;
          participant?: {
            _id: string;
            userId?:
              | {
                  _id: string;
                  firstName: string;
                  lastName: string;
                  email?: string;
                }
              | string;
            guestName?: string;
            guestEmail?: string;
          };
        } = {
          participantId: isPopulatedParticipant(split.participantId)
            ? objectIdToString(split.participantId._id)
            : objectIdToString(split.participantId),
          amount: split.amount,
          percentage: split.percentage,
        };

        if (isPopulatedParticipant(split.participantId)) {
          const participant = split.participantId;
          const participantData: {
            _id: string;
            userId?:
              | {
                  _id: string;
                  firstName: string;
                  lastName: string;
                  email?: string;
                }
              | string;
            guestName?: string;
            guestEmail?: string;
          } = {
            _id: objectIdToString(participant._id),
          };

          if (participant.userId) {
            if (isPopulatedUser(participant.userId)) {
              participantData.userId = {
                _id: objectIdToString(participant.userId._id),
                firstName: participant.userId.firstName,
                lastName: participant.userId.lastName,
                email: participant.userId.email,
              };
            } else {
              participantData.userId = objectIdToString(participant.userId);
            }
          }

          if (participant.guestName) {
            participantData.guestName = participant.guestName;
          }

          if (participant.guestEmail) {
            participantData.guestEmail = participant.guestEmail;
          }

          splitData.participant = participantData;
        }

        return splitData;
      });
    }

    return transformed as unknown as Expense;
  }

  private resolvePaymentMethodId(dto: {
    paymentMethodId?: string;
    cardId?: string;
  }): string | undefined {
    return dto.paymentMethodId || dto.cardId;
  }

  private mapKindToLegacyPaymentMethod(
    kind: PaymentMethodKind,
  ): ExpensePaymentMethod {
    return kind === PaymentMethodKind.CASH
      ? ExpensePaymentMethod.CASH
      : ExpensePaymentMethod.CARD;
  }

  private async assertCategoryBelongsToBoard(
    boardId: string,
    categoryId: string,
    userId: string,
  ): Promise<void> {
    const category = await this.categoriesService.findOne(categoryId, userId);

    if (category.tripId.toString() !== boardId) {
      throw new BadRequestException('La categoría no pertenece a este tablero');
    }

    if (!category.isActive) {
      throw new BadRequestException('La categoría no está activa');
    }
  }

  private async assertPaymentMethodAvailableForBoard(
    boardId: string,
    userId: string,
    paymentMethodId: string,
  ): Promise<PaymentMethodEntity> {
    const available = await this.paymentMethodsService.findAvailableForBoard(
      boardId,
      userId,
    );

    const method = available.find((item) => {
      const doc = item as PaymentMethodEntity & { _id: Types.ObjectId };
      return String(doc._id) === paymentMethodId;
    });

    if (!method) {
      throw new BadRequestException(
        'El medio de pago no está disponible para este tablero',
      );
    }

    return method;
  }

  private transformExpenses(expenses: any[]): Expense[] {
    return expenses.map((expense) => this.transformExpense(expense));
  }

  private getBudgetAmountForExpense(
    expense: Pick<Expense, 'amount' | 'currency' | 'fxRateToBoardCurrency'>,
    boardCurrency: string,
  ): number {
    return (
      getExpenseAmountInBoardCurrency(expense, boardCurrency) ?? expense.amount
    );
  }

  private async updateBudgetSpent(
    budgetId: string | undefined,
    amountChange: number,
  ): Promise<void> {
    if (!budgetId) return;
    await this.budgetModel.findByIdAndUpdate(budgetId, {
      $inc: { spent: amountChange },
    });
  }

  private async findExistingByClientRequestId(
    clientRequestId: string,
    userId: string,
  ): Promise<Expense | null> {
    const populatedExpense = await this.expenseModel
      .findOne({
        clientRequestId,
        createdBy: new Types.ObjectId(userId),
      })
      .populate(EXPENSE_RELATION_POPULATES)
      .lean();

    if (!populatedExpense) {
      return null;
    }

    return this.transformExpense(populatedExpense);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
