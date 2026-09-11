import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecurringIncome,
  RecurringIncomeDocument,
} from '../recurring-incomes/recurring-income.schema';
import {
  RecurringIncomeVersion,
  RecurringIncomeVersionDocument,
} from '../recurring-incomes/recurring-income-version.schema';
import {
  RecurringExpense,
  RecurringExpenseDocument,
} from '../recurring-expenses/recurring-expense.schema';
import {
  RecurringExpenseVersion,
  RecurringExpenseVersionDocument,
} from '../recurring-expenses/recurring-expense-version.schema';
import { Income, IncomeDocument, IncomeStatus } from '../incomes/income.schema';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
  PaymentMethod as ExpenseLegacyPaymentMethod,
  ExpenseFxPolicy,
  ExpenseFxPurpose,
} from '../expenses/expense.schema';
import {
  Participant,
  ParticipantDocument,
} from '../participants/schemas/participant.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { ExpenseFxResolver } from '../fx/expense-fx.resolver';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { DEFAULT_RECURRING_HORIZON_MONTHS } from '../common/constants/recurring-horizon';
import {
  buildOccurrenceDate,
  getYearMonthFromDate,
  iterateYearMonthsInclusive,
} from '../common/utils/iterate-year-months';
import {
  resolveAmountForYearMonth,
  RecurringEscalation,
} from '../common/utils/resolve-recurring-amount';
import { getValidDaysInMonth } from '../common/utils/validate-day-of-month';
import {
  getCurrentYearMonth,
  shiftYearMonth,
} from '../common/utils/parse-year-month';

export type AmountChangeScope = 'this_month' | 'from_month';

@Injectable()
export class RecurringMaterializationService {
  private readonly logger = new Logger(RecurringMaterializationService.name);

  constructor(
    @InjectModel(RecurringIncome.name)
    private recurringIncomeModel: Model<RecurringIncomeDocument>,
    @InjectModel(RecurringIncomeVersion.name)
    private recurringIncomeVersionModel: Model<RecurringIncomeVersionDocument>,
    @InjectModel(RecurringExpense.name)
    private recurringExpenseModel: Model<RecurringExpenseDocument>,
    @InjectModel(RecurringExpenseVersion.name)
    private recurringExpenseVersionModel: Model<RecurringExpenseVersionDocument>,
    @InjectModel(Income.name)
    private incomeModel: Model<IncomeDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private expenseFxResolver: ExpenseFxResolver,
  ) {}

  async ensureHorizon(
    boardId: string,
    userId: string,
    monthsAhead = DEFAULT_RECURRING_HORIZON_MONTHS,
  ): Promise<{ generated: number; horizonEnd: string }> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const startMonth = getCurrentYearMonth();
    const endMonth = shiftYearMonth(startMonth, monthsAhead - 1);

    await this.migrateLegacyVersions(boardId, userId);

    const boardObjectId = new Types.ObjectId(boardId);
    const [incomeRules, expenseRules] = await Promise.all([
      this.recurringIncomeModel
        .find({ tripId: boardObjectId, isActive: true })
        .lean(),
      this.recurringExpenseModel
        .find({ tripId: boardObjectId, isActive: true })
        .lean(),
    ]);

    const [incomeGenerated, expenseGenerated] = await Promise.all([
      Promise.all(
        incomeRules.map((rule) =>
          this.ensureIncomeOccurrences(rule, userId, startMonth, endMonth),
        ),
      ).then((counts) => counts.reduce((sum, count) => sum + count, 0)),
      Promise.all(
        expenseRules.map((rule) =>
          this.ensureExpenseOccurrences(rule, userId, startMonth, endMonth),
        ),
      ).then((counts) => counts.reduce((sum, count) => sum + count, 0)),
    ]);

    const generated = incomeGenerated + expenseGenerated;

    await this.expenseModel.updateMany(
      {
        tripId: boardObjectId,
        recurringExpenseId: { $exists: true },
        status: ExpenseStatus.PENDING,
        skippedAt: { $exists: false },
        expenseDate: { $lte: new Date() },
      },
      { $set: { status: ExpenseStatus.PAID } },
    );

    return { generated, horizonEnd: endMonth };
  }

  async createIncomeVersion(
    recurringIncomeId: string,
    amount: number,
    effectiveFrom: string,
    userId: string,
  ): Promise<RecurringIncomeVersion> {
    const rule = await this.recurringIncomeModel.findById(recurringIncomeId);
    if (!rule) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    const existing = await this.recurringIncomeVersionModel.findOne({
      recurringIncomeId: rule._id,
      effectiveFrom,
    });

    if (existing) {
      existing.amount = amount;
      const saved = await existing.save();
      rule.amount = amount;
      await rule.save();

      await this.syncPendingIncomeAmountsFromMonth(
        rule._id.toString(),
        effectiveFrom,
      );

      return saved;
    }

    const version = new this.recurringIncomeVersionModel({
      recurringIncomeId: rule._id,
      amount,
      effectiveFrom,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await version.save();
    rule.amount = amount;
    await rule.save();

    await this.syncPendingIncomeAmountsFromMonth(
      rule._id.toString(),
      effectiveFrom,
    );

    return saved;
  }

  async createExpenseVersion(
    recurringExpenseId: string,
    amount: number,
    effectiveFrom: string,
    userId: string,
  ): Promise<RecurringExpenseVersion> {
    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    if (!rule) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    const existing = await this.recurringExpenseVersionModel.findOne({
      recurringExpenseId: rule._id,
      effectiveFrom,
    });

    if (existing) {
      existing.amount = amount;
      const saved = await existing.save();
      rule.amount = amount;
      await rule.save();

      await this.syncPendingExpenseAmountsFromMonth(
        rule._id.toString(),
        effectiveFrom,
      );

      return saved;
    }

    const version = new this.recurringExpenseVersionModel({
      recurringExpenseId: rule._id,
      amount,
      effectiveFrom,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await version.save();
    rule.amount = amount;
    await rule.save();

    await this.syncPendingExpenseAmountsFromMonth(
      rule._id.toString(),
      effectiveFrom,
    );

    return saved;
  }

  async applyIncomeAmountChange(
    recurringIncomeId: string,
    amount: number,
    scope: AmountChangeScope,
    yearMonth: string,
    userId: string,
  ): Promise<void> {
    if (scope === 'from_month') {
      await this.createIncomeVersion(
        recurringIncomeId,
        amount,
        yearMonth,
        userId,
      );
      return;
    }

    const rule = await this.recurringIncomeModel.findById(recurringIncomeId);
    if (!rule) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    const { from, toExclusive } = this.getMonthDateRange(yearMonth);

    await this.incomeModel.updateMany(
      {
        recurringIncomeId: rule._id,
        status: IncomeStatus.PENDING,
        skippedAt: { $exists: false },
        incomeDate: { $gte: from, $lt: toExclusive },
      },
      { $set: { amount } },
    );
  }

  async applyExpenseAmountChange(
    recurringExpenseId: string,
    amount: number,
    scope: AmountChangeScope,
    yearMonth: string,
    userId: string,
  ): Promise<void> {
    if (scope === 'from_month') {
      await this.createExpenseVersion(
        recurringExpenseId,
        amount,
        yearMonth,
        userId,
      );
      return;
    }

    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    if (!rule) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    const { from, toExclusive } = this.getMonthDateRange(yearMonth);

    await this.expenseModel.updateMany(
      {
        recurringExpenseId: rule._id,
        status: ExpenseStatus.PENDING,
        skippedAt: { $exists: false },
        expenseDate: { $gte: from, $lt: toExclusive },
      },
      { $set: { amount } },
    );
  }

  async cancelIncomeFromMonth(
    recurringIncomeId: string,
    fromYearMonth: string,
    userId: string,
  ): Promise<void> {
    const rule = await this.recurringIncomeModel.findById(recurringIncomeId);
    if (!rule) {
      throw new NotFoundException('Ingreso recurrente no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    rule.inactiveFromYearMonth = fromYearMonth;
    if (fromYearMonth <= getCurrentYearMonth()) {
      rule.isActive = false;
    }
    await rule.save();

    await this.removePendingIncomeFromMonth(rule._id, fromYearMonth);
  }

  async cancelExpenseFromMonth(
    recurringExpenseId: string,
    fromYearMonth: string,
    userId: string,
  ): Promise<void> {
    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    if (!rule) {
      throw new NotFoundException('Gasto fijo no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      rule.tripId.toString(),
      userId,
    );

    rule.inactiveFromYearMonth = fromYearMonth;
    if (fromYearMonth <= getCurrentYearMonth()) {
      rule.isActive = false;
    }
    await rule.save();

    await this.removePendingExpensesFromMonth(rule._id, fromYearMonth);
  }

  async skipIncomeOccurrence(incomeId: string, userId: string): Promise<void> {
    const income = await this.incomeModel.findById(incomeId);
    if (!income?.recurringIncomeId) {
      throw new BadRequestException(
        'Solo se pueden omitir ingresos recurrentes',
      );
    }

    await this.participantsService.ensureParticipantAccess(
      income.tripId.toString(),
      userId,
    );

    if (income.status === IncomeStatus.CONFIRMED) {
      throw new BadRequestException('No se puede omitir un ingreso ya cobrado');
    }

    income.skippedAt = new Date();
    await income.save();
  }

  async skipExpenseOccurrence(
    expenseId: string,
    userId: string,
  ): Promise<void> {
    const expense = await this.expenseModel.findById(expenseId);
    if (!expense?.recurringExpenseId && !expense?.installmentPlanId) {
      throw new BadRequestException('Solo se pueden omitir gastos programados');
    }

    await this.participantsService.ensureParticipantAccess(
      expense.tripId.toString(),
      userId,
    );

    if (expense.status === ExpenseStatus.PAID) {
      throw new BadRequestException('No se puede omitir un gasto ya pagado');
    }

    expense.skippedAt = new Date();
    await expense.save();
  }

  async deleteRuleOccurrences(
    recurringIncomeId: string | null,
    recurringExpenseId: string | null,
  ): Promise<void> {
    if (recurringIncomeId) {
      await this.incomeModel.deleteMany({
        recurringIncomeId: new Types.ObjectId(recurringIncomeId),
        status: IncomeStatus.PENDING,
      });
      await this.recurringIncomeVersionModel.deleteMany({
        recurringIncomeId: new Types.ObjectId(recurringIncomeId),
      });
    }

    if (recurringExpenseId) {
      await this.expenseModel.deleteMany({
        recurringExpenseId: new Types.ObjectId(recurringExpenseId),
        status: ExpenseStatus.PENDING,
      });
      await this.recurringExpenseVersionModel.deleteMany({
        recurringExpenseId: new Types.ObjectId(recurringExpenseId),
      });
    }
  }

  private async migrateLegacyVersions(
    boardId: string,
    userId: string,
  ): Promise<void> {
    const boardObjectId = new Types.ObjectId(boardId);

    const migrateIncomeRule = async (
      rule: RecurringIncome & { _id: Types.ObjectId; createdAt?: Date },
    ): Promise<void> => {
      const versionCount =
        await this.recurringIncomeVersionModel.countDocuments({
          recurringIncomeId: rule._id,
        });
      if (versionCount > 0) return;

      const effectiveFrom = rule.createdAt
        ? getYearMonthFromDate(new Date(rule.createdAt))
        : getCurrentYearMonth();

      await this.recurringIncomeVersionModel.create({
        recurringIncomeId: rule._id,
        amount: rule.amount,
        effectiveFrom,
        createdBy: rule.createdBy ?? new Types.ObjectId(userId),
      });
    };

    const migrateExpenseRule = async (
      rule: RecurringExpense & { _id: Types.ObjectId; createdAt?: Date },
    ): Promise<void> => {
      const versionCount =
        await this.recurringExpenseVersionModel.countDocuments({
          recurringExpenseId: rule._id,
        });
      if (versionCount > 0) return;

      const effectiveFrom = rule.createdAt
        ? getYearMonthFromDate(new Date(rule.createdAt))
        : getCurrentYearMonth();

      await this.recurringExpenseVersionModel.create({
        recurringExpenseId: rule._id,
        amount: rule.amount,
        effectiveFrom,
        createdBy: rule.createdBy ?? new Types.ObjectId(userId),
      });
    };

    const [incomeRules, expenseRules] = await Promise.all([
      this.recurringIncomeModel.find({ tripId: boardObjectId }).lean(),
      this.recurringExpenseModel.find({ tripId: boardObjectId }).lean(),
    ]);

    await Promise.all([
      ...incomeRules.map((rule) =>
        migrateIncomeRule(
          rule as RecurringIncome & { _id: Types.ObjectId; createdAt?: Date },
        ),
      ),
      ...expenseRules.map((rule) =>
        migrateExpenseRule(
          rule as RecurringExpense & {
            _id: Types.ObjectId;
            createdAt?: Date;
          },
        ),
      ),
    ]);
  }

  private async ensureIncomeOccurrences(
    rule: RecurringIncome & { _id: Types.ObjectId; createdAt?: Date },
    userId: string,
    startMonth: string,
    endMonth: string,
  ): Promise<number> {
    const versions = await this.recurringIncomeVersionModel
      .find({ recurringIncomeId: rule._id })
      .lean();

    if (versions.length === 0) return 0;

    const generationStart = this.getRuleGenerationStart(rule, startMonth);
    if (generationStart > endMonth) return 0;

    const generateForMonth = async (yearMonth: string): Promise<number> => {
      if (this.isRuleInactiveForMonth(rule, yearMonth)) return 0;
      if (rule.excludedYearMonths?.includes(yearMonth)) return 0;

      const amount = resolveAmountForYearMonth(versions, yearMonth);
      if (amount == null) return 0;

      const validDays = getValidDaysInMonth(rule.daysOfMonth, yearMonth);

      const dayResults = await Promise.all(
        validDays.map(async (day) => {
          const occurrenceKey = `ri:${rule._id.toString()}:${yearMonth}:${day}`;
          const existing = await this.incomeModel.findOne({ occurrenceKey });
          if (existing) return 0;

          try {
            await this.incomeModel.create({
              tripId: rule.tripId,
              amount,
              currency: rule.currency,
              label: rule.label,
              description: rule.description,
              incomeDate: buildOccurrenceDate(yearMonth, day),
              status: IncomeStatus.PENDING,
              recurringIncomeId: rule._id,
              occurrenceKey,
              createdBy: rule.createdBy,
            });
            return 1;
          } catch (error) {
            if (!this.isDuplicateKeyError(error)) {
              throw error;
            }
            return 0;
          }
        }),
      );

      return dayResults.reduce((sum, count) => sum + count, 0);
    };

    const monthResults = await Promise.all(
      iterateYearMonthsInclusive(generationStart, endMonth).map(
        generateForMonth,
      ),
    );

    return monthResults.reduce((sum, count) => sum + count, 0);
  }

  private async ensureExpenseOccurrences(
    rule: RecurringExpense & { _id: Types.ObjectId; createdAt?: Date },
    userId: string,
    startMonth: string,
    endMonth: string,
  ): Promise<number> {
    const versions = await this.recurringExpenseVersionModel
      .find({ recurringExpenseId: rule._id })
      .lean();

    if (versions.length === 0) return 0;

    let participant = await this.participantModel.findOne({
      tripId: rule.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      participant = await this.participantModel.findOne({
        tripId: rule.tripId,
        userId: rule.createdBy,
      });
    }

    if (!participant) {
      this.logger.warn(
        `No participant for recurring expense ${rule._id.toString()}`,
      );
      return 0;
    }

    const board = await this.boardsService.findByIdOrFail(
      rule.tripId.toString(),
    );
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;

    const generationStart = this.getRuleGenerationStart(rule, startMonth);
    if (generationStart > endMonth) return 0;

    const generateForMonth = async (yearMonth: string): Promise<number> => {
      if (this.isRuleInactiveForMonth(rule, yearMonth)) return 0;
      if (rule.excludedYearMonths?.includes(yearMonth)) return 0;

      const amount = resolveAmountForYearMonth(
        versions,
        yearMonth,
        this.buildExpenseEscalation(rule),
      );
      if (amount == null) return 0;

      const validDays = getValidDaysInMonth([rule.dayOfMonth], yearMonth);
      if (validDays.length === 0) return 0;

      const day = validDays[0];
      const occurrenceKey = `re:${rule._id.toString()}:${yearMonth}:${day}`;
      const existing = await this.expenseModel.findOne({ occurrenceKey });
      if (existing) return 0;

      const expenseDate = buildOccurrenceDate(yearMonth, day);
      const fxOnCreate = this.expenseFxResolver.buildFxOnCreate({
        expenseCurrency: rule.currency,
        boardCurrency,
      });

      let fxRateToBoardCurrency: number | undefined;
      let fxCapturedAt: Date | undefined;
      let fxPolicy: ExpenseFxPolicy | undefined;
      let fxPurpose: ExpenseFxPurpose | undefined;

      if (fxOnCreate) {
        fxPolicy = fxOnCreate.fxPolicy;
        fxPurpose = fxOnCreate.fxPurpose;

        if (fxOnCreate.fxPolicy === ExpenseFxPolicy.SPOT) {
          const snapshot = await this.expenseFxResolver.resolveSpotSnapshot(
            rule.currency,
            boardCurrency,
          );
          fxRateToBoardCurrency = snapshot.fxRateToBoardCurrency;
          fxCapturedAt = snapshot.fxCapturedAt;
        }
      }

      try {
        await this.expenseModel.create({
          tripId: rule.tripId,
          amount,
          currency: rule.currency,
          fxRateToBoardCurrency,
          fxCapturedAt,
          fxPolicy,
          fxPurpose,
          paymentYearMonth: yearMonth,
          description: rule.label,
          categoryId: rule.categoryId,
          paymentMethodId: rule.paymentMethodId,
          cardId: rule.paymentMethodId,
          paidByParticipantId: participant._id,
          status: ExpenseStatus.PENDING,
          paymentMethod: ExpenseLegacyPaymentMethod.CASH,
          isDivisible: false,
          recurringExpenseId: rule._id,
          occurrenceKey,
          expenseDate,
          createdBy: rule.createdBy,
        });
        return 1;
      } catch (error) {
        if (!this.isDuplicateKeyError(error)) {
          throw error;
        }
        return 0;
      }
    };

    const monthResults = await Promise.all(
      iterateYearMonthsInclusive(generationStart, endMonth).map(
        generateForMonth,
      ),
    );

    return monthResults.reduce((sum, count) => sum + count, 0);
  }

  private getRuleGenerationStart(
    rule: RecurringIncome | RecurringExpense,
    horizonStart: string,
  ): string {
    return horizonStart;
  }

  private isRuleInactiveForMonth(
    rule: RecurringIncome | RecurringExpense,
    yearMonth: string,
  ): boolean {
    return Boolean(
      rule.inactiveFromYearMonth && yearMonth >= rule.inactiveFromYearMonth,
    );
  }

  private async syncPendingIncomeAmountsFromMonth(
    recurringIncomeId: string,
    fromYearMonth: string,
  ): Promise<void> {
    const versions = await this.recurringIncomeVersionModel
      .find({ recurringIncomeId: new Types.ObjectId(recurringIncomeId) })
      .lean();

    const pending = await this.incomeModel.find({
      recurringIncomeId: new Types.ObjectId(recurringIncomeId),
      status: IncomeStatus.PENDING,
      skippedAt: { $exists: false },
    });

    for (const income of pending) {
      const yearMonth = getYearMonthFromDate(income.incomeDate);
      if (yearMonth < fromYearMonth) continue;

      const amount = resolveAmountForYearMonth(versions, yearMonth);
      if (amount != null) {
        income.amount = amount;
        await income.save();
      }
    }
  }

  async syncPendingExpenseAmountsFromMonth(
    recurringExpenseId: string,
    fromYearMonth: string,
  ): Promise<void> {
    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    const versions = await this.recurringExpenseVersionModel
      .find({ recurringExpenseId: new Types.ObjectId(recurringExpenseId) })
      .lean();

    const pending = await this.expenseModel.find({
      recurringExpenseId: new Types.ObjectId(recurringExpenseId),
      status: ExpenseStatus.PENDING,
      skippedAt: { $exists: false },
    });

    for (const expense of pending) {
      const yearMonth = getYearMonthFromDate(expense.expenseDate);
      if (yearMonth < fromYearMonth) continue;

      const amount = resolveAmountForYearMonth(
        versions,
        yearMonth,
        rule ? this.buildExpenseEscalation(rule) : undefined,
      );
      if (amount != null) {
        expense.amount = amount;
        await expense.save();
      }
    }
  }

  private async removePendingIncomeFromMonth(
    recurringIncomeId: Types.ObjectId,
    fromYearMonth: string,
  ): Promise<void> {
    const fromDate = buildOccurrenceDate(fromYearMonth, 1);
    await this.incomeModel.deleteMany({
      recurringIncomeId,
      status: IncomeStatus.PENDING,
      incomeDate: { $gte: fromDate },
    });
  }

  private async removePendingExpensesFromMonth(
    recurringExpenseId: Types.ObjectId,
    fromYearMonth: string,
  ): Promise<void> {
    const fromDate = buildOccurrenceDate(fromYearMonth, 1);
    await this.expenseModel.deleteMany({
      recurringExpenseId,
      status: ExpenseStatus.PENDING,
      expenseDate: { $gte: fromDate },
    });
  }

  /**
   * Called when a rule's excludedYearMonths checklist gains new months.
   * Only removes pending occurrences for those specific months — paid
   * history and other months are never touched.
   */
  async removePendingIncomeForExcludedMonths(
    recurringIncomeId: string,
    newlyExcludedYearMonths: string[],
  ): Promise<void> {
    if (newlyExcludedYearMonths.length === 0) return;
    const rule = await this.recurringIncomeModel.findById(recurringIncomeId);
    if (!rule) return;

    for (const yearMonth of newlyExcludedYearMonths) {
      const { from, toExclusive } = this.getMonthDateRange(yearMonth);
      await this.incomeModel.deleteMany({
        recurringIncomeId: rule._id,
        status: IncomeStatus.PENDING,
        skippedAt: { $exists: false },
        incomeDate: { $gte: from, $lt: toExclusive },
      });
    }
  }

  async removePendingExpensesForExcludedMonths(
    recurringExpenseId: string,
    newlyExcludedYearMonths: string[],
  ): Promise<void> {
    if (newlyExcludedYearMonths.length === 0) return;
    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    if (!rule) return;

    await this.expenseModel.deleteMany({
      recurringExpenseId: rule._id,
      status: ExpenseStatus.PENDING,
      skippedAt: { $exists: false },
      paymentYearMonth: { $in: newlyExcludedYearMonths },
    });
  }

  /**
   * Called when a rule's dayOfMonth changes. Pending occurrences were
   * materialized under the old day's occurrenceKey, so ensureHorizon would
   * otherwise generate new ones for the new day alongside them, duplicating
   * the expense. Paid history is untouched (status filter).
   */
  async removePendingExpensesForDayChange(
    recurringExpenseId: string,
  ): Promise<void> {
    const rule = await this.recurringExpenseModel.findById(recurringExpenseId);
    if (!rule) return;

    await this.expenseModel.deleteMany({
      recurringExpenseId: rule._id,
      status: ExpenseStatus.PENDING,
      skippedAt: { $exists: false },
    });
  }

  private getMonthDateRange(yearMonth: string): {
    from: Date;
    toExclusive: Date;
  } {
    const from = buildOccurrenceDate(yearMonth, 1);
    const toExclusive = buildOccurrenceDate(shiftYearMonth(yearMonth, 1), 1);
    return { from, toExclusive };
  }

  private buildExpenseEscalation(
    rule: Pick<
      RecurringExpense,
      'escalationType' | 'escalationValue' | 'escalationFrequencyMonths'
    >,
  ): RecurringEscalation | undefined {
    if (
      !rule.escalationType ||
      !rule.escalationValue ||
      !rule.escalationFrequencyMonths
    ) {
      return undefined;
    }
    return {
      type: rule.escalationType,
      value: rule.escalationValue,
      frequencyMonths: rule.escalationFrequencyMonths,
    };
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
