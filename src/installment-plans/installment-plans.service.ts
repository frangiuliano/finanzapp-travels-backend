import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstallmentPlan,
  InstallmentPlanDocument,
} from './installment-plan.schema';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import {
  UpdateInstallmentPlanDto,
  InstallmentOverridePolicy,
} from './dto/update-installment-plan.dto';
import {
  InstallmentPlanUpdateResult,
  InstallmentCustomOverrideItem,
} from './dto/update-installment-plan-result';
import {
  RescheduleInstallmentDto,
  InstallmentRescheduleScope,
} from './dto/reschedule-installment.dto';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { CategoriesService } from '../categories/categories.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { assertValidDayOfMonth } from '../common/utils/validate-day-of-month';
import { parseYearMonth } from '../common/utils/parse-year-month';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { FxService } from '../fx/fx.service';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
  PaymentMethod,
} from '../expenses/expense.schema';
import {
  Participant,
  ParticipantDocument,
} from '../participants/schemas/participant.schema';
import {
  shiftYearMonth,
  monthsBetweenYearMonths,
} from '../common/utils/parse-year-month';
import { buildOccurrenceDate } from '../common/utils/iterate-year-months';

@Injectable()
export class InstallmentPlansService {
  private readonly logger = new Logger(InstallmentPlansService.name);

  constructor(
    @InjectModel(InstallmentPlan.name)
    private installmentPlanModel: Model<InstallmentPlanDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    private participantsService: ParticipantsService,
    private boardsService: BoardsService,
    private fxService: FxService,
    private categoriesService: CategoriesService,
  ) {}

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

  async create(
    createDto: CreateInstallmentPlanDto,
    userId: string,
  ): Promise<InstallmentPlan> {
    const boardId = resolveBoardId(createDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    assertValidDayOfMonth(createDto.dayOfMonth);
    parseYearMonth(createDto.startYearMonth);

    if ((createDto.paidInstallments ?? 0) > createDto.totalInstallments) {
      throw new BadRequestException(
        'paidInstallments no puede superar totalInstallments',
      );
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const board = await this.boardsService.findByIdOrFail(boardId);
    const boardCurrency = board.baseCurrency ?? DEFAULT_CURRENCY;
    const currency = createDto.currency ?? boardCurrency;

    if (createDto.categoryId) {
      await this.assertCategoryBelongsToBoard(
        boardId,
        createDto.categoryId,
        userId,
      );
    }

    const fxSnapshot = await this.fxService.resolveSnapshot(
      currency,
      boardCurrency,
      createDto.fxRateOverride,
    );

    const plan = new this.installmentPlanModel({
      tripId: new Types.ObjectId(boardId),
      label: createDto.label.trim(),
      installmentAmount: createDto.installmentAmount,
      totalInstallments: createDto.totalInstallments,
      paidInstallments: createDto.paidInstallments ?? 0,
      startYearMonth: createDto.startYearMonth,
      dayOfMonth: createDto.dayOfMonth,
      paymentMethodId: createDto.paymentMethodId
        ? new Types.ObjectId(createDto.paymentMethodId)
        : undefined,
      categoryId: createDto.categoryId
        ? new Types.ObjectId(createDto.categoryId)
        : undefined,
      currency,
      fxRateToBoardCurrency:
        currency === boardCurrency
          ? undefined
          : fxSnapshot.fxRateToBoardCurrency,
      fxCapturedAt:
        currency === boardCurrency ? undefined : fxSnapshot.fxCapturedAt,
      createdBy: new Types.ObjectId(userId),
    });

    const saved = await plan.save();
    await this.syncExpenseOccurrences(saved, userId, false);
    await saved.populate('categoryId', '_id name icon color isActive');
    this.logger.log(
      `Installment plan created: ${saved._id.toString()} on board ${boardId}`,
    );
    return saved;
  }

  async findAllByBoard(
    boardId: string,
    userId: string,
  ): Promise<Array<InstallmentPlan & { paidCount: number }>> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const plans = await this.installmentPlanModel
      .find({ tripId: new Types.ObjectId(boardId) })
      .sort({ startYearMonth: 1, label: 1 })
      .populate('categoryId', '_id name icon color isActive')
      .lean();
    if (plans.length === 0) return [];

    // paidInstallments is a one-time seed: cuotas 1..paidInstallments were
    // already paid before this plan started being tracked here, so they are
    // never materialized as Expense documents (materialization starts at
    // paidInstallments + 1). The live count only covers what got
    // materialized since, so the real total is the seed plus that live
    // count — never just the live count on its own.
    //
    // Some legacy plans ended up with cuotas materialized inside the seed's
    // own range too (a pre-existing data artifact), which would double-count
    // if taken at face value — so only cuotas past the seed are counted live.
    const paidExpenses = await this.expenseModel
      .find(
        {
          installmentPlanId: { $in: plans.map((plan) => plan._id) },
          status: ExpenseStatus.PAID,
        },
        { installmentPlanId: 1, installmentNumber: 1 },
      )
      .lean();
    const paidCountByPlanId = new Map<string, number>();
    const paidInstallmentsByPlanId = new Map(
      plans.map((plan) => [plan._id.toString(), plan.paidInstallments]),
    );
    for (const expense of paidExpenses) {
      if (!expense.installmentPlanId) continue;
      const planId = expense.installmentPlanId.toString();
      const seed = paidInstallmentsByPlanId.get(planId) ?? 0;
      if ((expense.installmentNumber ?? 0) <= seed) continue;
      paidCountByPlanId.set(planId, (paidCountByPlanId.get(planId) ?? 0) + 1);
    }

    return plans.map((plan) => ({
      ...plan,
      paidCount:
        plan.paidInstallments +
        (paidCountByPlanId.get(plan._id.toString()) ?? 0),
    }));
  }

  async findActiveByBoard(
    boardId: string,
    userId: string,
  ): Promise<InstallmentPlan[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    return this.installmentPlanModel
      .find({ tripId: new Types.ObjectId(boardId), isActive: true })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<InstallmentPlan> {
    const item = await this.installmentPlanModel
      .findById(id)
      .populate('categoryId', '_id name icon color isActive')
      .lean();
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    return item;
  }

  async update(
    id: string,
    updateDto: UpdateInstallmentPlanDto,
    userId: string,
  ): Promise<InstallmentPlanUpdateResult> {
    const item = await this.installmentPlanModel.findById(id);
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    if (updateDto.startYearMonth !== undefined) {
      parseYearMonth(updateDto.startYearMonth);
    }
    if (updateDto.dayOfMonth !== undefined) {
      assertValidDayOfMonth(updateDto.dayOfMonth);
    }
    if (updateDto.categoryId !== undefined) {
      await this.assertCategoryBelongsToBoard(
        item.tripId.toString(),
        updateDto.categoryId,
        userId,
      );
    }

    const nextTotalInstallments =
      updateDto.totalInstallments ?? item.totalInstallments;
    if (item.paidInstallments > nextTotalInstallments) {
      throw new BadRequestException(
        'paidInstallments no puede superar totalInstallments',
      );
    }

    const amountOrLabelChanging =
      updateDto.installmentAmount !== undefined ||
      updateDto.label !== undefined;
    const nextInstallmentAmount =
      updateDto.installmentAmount ?? item.installmentAmount;
    const nextLabel = updateDto.label?.trim() ?? item.label;

    const customizedExpenses = amountOrLabelChanging
      ? (
          await this.expenseModel.find({
            installmentPlanId: item._id,
            status: { $ne: ExpenseStatus.PAID },
            skippedAt: { $exists: false },
          })
        ).filter((expense) => this.isExpenseCustomized(expense, item))
      : [];

    if (customizedExpenses.length > 0 && updateDto.overridePolicy == null) {
      return {
        status: 'needs_decision',
        customOverrides: this.buildCustomOverridesInfo(customizedExpenses),
      };
    }

    if (updateDto.label !== undefined) item.label = nextLabel;
    if (updateDto.installmentAmount !== undefined) {
      item.installmentAmount = nextInstallmentAmount;
    }
    if (updateDto.totalInstallments !== undefined) {
      item.totalInstallments = updateDto.totalInstallments;
    }
    if (updateDto.startYearMonth !== undefined) {
      item.startYearMonth = updateDto.startYearMonth;
    }
    if (updateDto.dayOfMonth !== undefined) {
      item.dayOfMonth = updateDto.dayOfMonth;
    }
    if (updateDto.paymentMethodId !== undefined) {
      item.paymentMethodId = updateDto.paymentMethodId
        ? new Types.ObjectId(updateDto.paymentMethodId)
        : undefined;
    }
    if (updateDto.currency !== undefined) item.currency = updateDto.currency;
    if (updateDto.isActive !== undefined) item.isActive = updateDto.isActive;
    if (updateDto.categoryId !== undefined) {
      item.categoryId = new Types.ObjectId(updateDto.categoryId);
    }

    const saved = await item.save();

    if (updateDto.categoryId !== undefined) {
      // Category applies to every cuota of the plan, paid or pending —
      // unlike amount/label, it's not something a single cuota customizes
      // on its own, so there's no override to preserve.
      await this.expenseModel.updateMany(
        { installmentPlanId: saved._id },
        { $set: { categoryId: saved.categoryId } },
      );
    }

    const reconciliation = await this.reconcileExpenseOccurrences(saved, {
      fallbackUserId: userId,
      overridePolicy:
        customizedExpenses.length > 0 ? updateDto.overridePolicy : undefined,
      amountOrLabelChanging,
    });

    this.logger.log(`Installment plan updated: ${id}`);

    // Only count cuotas past the seed's own range — see the matching comment
    // in findAllByBoard for why a plan can have paid cuotas materialized
    // inside that range too, which must not be double-counted here.
    const livePaidCount = await this.expenseModel.countDocuments({
      installmentPlanId: saved._id,
      status: ExpenseStatus.PAID,
      skippedAt: { $exists: false },
      installmentNumber: { $gt: saved.paidInstallments },
    });
    const paidCount = saved.paidInstallments + livePaidCount;
    await saved.populate('categoryId', '_id name icon color isActive');

    return {
      status: 'applied',
      installmentPlan: { ...(saved.toObject() as InstallmentPlan), paidCount },
      applied: {
        datesUpdated: reconciliation.datesUpdated,
        overridePolicy:
          customizedExpenses.length > 0 ? updateDto.overridePolicy : undefined,
        overridesPreserved: reconciliation.overridesPreserved,
        overridesReplaced: reconciliation.overridesReplaced,
      },
    };
  }

  /**
   * Conservative "is this cuota customized" check. Explicit metadata wins;
   * for legacy expenses without it, a mismatch against the plan's own
   * (pre-save) defaults is treated as a manual edit worth protecting.
   */
  private isExpenseCustomized(
    expense: ExpenseDocument,
    plan: InstallmentPlanDocument,
  ): boolean {
    if (expense.overriddenFields && expense.overriddenFields.length > 0) {
      return true;
    }
    return (
      expense.amount !== plan.installmentAmount ||
      expense.description !== plan.label
    );
  }

  private buildCustomOverridesInfo(expenses: ExpenseDocument[]): {
    count: number;
    items: InstallmentCustomOverrideItem[];
  } {
    return {
      count: expenses.length,
      items: expenses
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0))
        .map((expense) => ({
          installmentNumber: expense.installmentNumber ?? 0,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency,
          overriddenFields:
            expense.overriddenFields && expense.overriddenFields.length > 0
              ? expense.overriddenFields
              : ['amount', 'description'],
        })),
    };
  }

  async remove(id: string, userId: string): Promise<void> {
    const item = await this.installmentPlanModel.findById(id);
    if (!item) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      item.tripId.toString(),
      userId,
    );

    await this.expenseModel.deleteMany({
      installmentPlanId: item._id,
      status: ExpenseStatus.PENDING,
    });
    await this.installmentPlanModel.findByIdAndDelete(id);
    this.logger.log(`Installment plan deleted: ${id}`);
  }

  async ensureExpenseOccurrences(
    boardId: string,
    userId: string,
  ): Promise<void> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);
    const plans = await this.installmentPlanModel.find({
      tripId: new Types.ObjectId(boardId),
      isActive: true,
    });

    for (const plan of plans) {
      await this.syncExpenseOccurrences(plan, userId, false);
    }
  }

  private async syncExpenseOccurrences(
    plan: InstallmentPlanDocument,
    fallbackUserId: string,
    replacePending: boolean,
  ): Promise<void> {
    if (replacePending) {
      await this.expenseModel.deleteMany({
        installmentPlanId: plan._id,
        status: ExpenseStatus.PENDING,
        skippedAt: { $exists: false },
      });
    }
    if (!plan.isActive) return;

    const payer = await this.participantModel.findOne({
      tripId: plan.tripId,
      userId: plan.createdBy,
    });
    const fallbackPayer = payer
      ? null
      : await this.participantModel.findOne({
          tripId: plan.tripId,
          userId: new Types.ObjectId(fallbackUserId),
        });
    const paidByParticipantId = payer?._id ?? fallbackPayer?._id;
    if (!paidByParticipantId) return;

    const now = new Date();
    for (
      let installmentNumber = plan.paidInstallments + 1;
      installmentNumber <= plan.totalInstallments;
      installmentNumber += 1
    ) {
      const yearMonth = shiftYearMonth(
        plan.startYearMonth,
        installmentNumber - 1,
      );
      const expenseDate = buildOccurrenceDate(yearMonth, plan.dayOfMonth);
      const status =
        expenseDate <= now ? ExpenseStatus.PAID : ExpenseStatus.PENDING;
      const occurrenceKey = `installment:${plan._id.toString()}:${installmentNumber}`;

      await this.expenseModel.updateOne(
        { occurrenceKey },
        {
          $setOnInsert: {
            tripId: plan.tripId,
            amount: plan.installmentAmount,
            currency: plan.currency,
            fxRateToBoardCurrency: plan.fxRateToBoardCurrency,
            fxCapturedAt: plan.fxCapturedAt,
            paymentYearMonth: yearMonth,
            description: plan.label,
            paidByParticipantId,
            status,
            paymentMethod: plan.paymentMethodId
              ? PaymentMethod.CARD
              : PaymentMethod.CASH,
            paymentMethodId: plan.paymentMethodId,
            cardId: plan.paymentMethodId,
            isDivisible: false,
            installmentPlanId: plan._id,
            installmentNumber,
            occurrenceKey,
            expenseDate,
            createdBy: plan.createdBy,
            categoryId: plan.categoryId,
          },
        },
        { upsert: true },
      );
    }

    await this.expenseModel.updateMany(
      {
        installmentPlanId: plan._id,
        status: ExpenseStatus.PENDING,
        skippedAt: { $exists: false },
        expenseDate: { $lte: now },
      },
      { $set: { status: ExpenseStatus.PAID } },
    );
  }

  /**
   * Non-destructive counterpart to `syncExpenseOccurrences(..., true)`.
   * Reconciles cuotas in place by occurrenceKey instead of deleting and
   * recreating pending ones, so manual per-cuota edits survive a plan save:
   *  - Pending cuotas always follow the plan's current schedule (month from
   *    startYearMonth + installmentNumber, day from plan.dayOfMonth — both
   *    purely informational, no card-cycle math involved).
   *  - Paid cuotas are never touched here — history stays as recorded.
   *  - Skipped (tombstoned) cuotas are never read past the skip check.
   *  - Missing occurrences (e.g. totalInstallments grew) are created fresh.
   *  - Pending occurrences beyond the new totalInstallments are removed;
   *    paid and skipped ones never are.
   *  - Plan-level amount/label changes propagate to pending cuotas unless
   *    customized, per the confirmed overridePolicy.
   */
  private async reconcileExpenseOccurrences(
    plan: InstallmentPlanDocument,
    options: {
      fallbackUserId: string;
      overridePolicy?: InstallmentOverridePolicy;
      amountOrLabelChanging: boolean;
    },
  ): Promise<{
    datesUpdated: number;
    overridesPreserved: number;
    overridesReplaced: number;
  }> {
    const result = {
      datesUpdated: 0,
      overridesPreserved: 0,
      overridesReplaced: 0,
    };
    if (!plan.isActive) return result;

    const payer = await this.participantModel.findOne({
      tripId: plan.tripId,
      userId: plan.createdBy,
    });
    const fallbackPayer = payer
      ? null
      : await this.participantModel.findOne({
          tripId: plan.tripId,
          userId: new Types.ObjectId(options.fallbackUserId),
        });
    const paidByParticipantId = payer?._id ?? fallbackPayer?._id;
    if (!paidByParticipantId) return result;

    const now = new Date();

    for (
      let installmentNumber = 1;
      installmentNumber <= plan.totalInstallments;
      installmentNumber += 1
    ) {
      const occurrenceKey = `installment:${plan._id.toString()}:${installmentNumber}`;
      const yearMonth = shiftYearMonth(
        plan.startYearMonth,
        installmentNumber - 1,
      );
      const existing = await this.expenseModel.findOne({ occurrenceKey });

      if (!existing) {
        const expenseDate = buildOccurrenceDate(yearMonth, plan.dayOfMonth);
        const status =
          expenseDate <= now ? ExpenseStatus.PAID : ExpenseStatus.PENDING;

        await this.expenseModel.create({
          tripId: plan.tripId,
          amount: plan.installmentAmount,
          currency: plan.currency,
          fxRateToBoardCurrency: plan.fxRateToBoardCurrency,
          fxCapturedAt: plan.fxCapturedAt,
          paymentYearMonth: yearMonth,
          description: plan.label,
          paidByParticipantId,
          status,
          paymentMethod: plan.paymentMethodId
            ? PaymentMethod.CARD
            : PaymentMethod.CASH,
          paymentMethodId: plan.paymentMethodId,
          cardId: plan.paymentMethodId,
          isDivisible: false,
          installmentPlanId: plan._id,
          installmentNumber,
          occurrenceKey,
          expenseDate,
          createdBy: plan.createdBy,
          categoryId: plan.categoryId,
        });
        continue;
      }

      // Omitted occurrence: tombstone, must never be updated or regenerated.
      if (existing.skippedAt) continue;
      // Paid history is never rewritten by a plan-level save.
      if (existing.status === ExpenseStatus.PAID) continue;

      const newDate = buildOccurrenceDate(yearMonth, plan.dayOfMonth);
      if (existing.expenseDate?.getTime() !== newDate.getTime()) {
        existing.expenseDate = newDate;
        existing.paymentYearMonth = yearMonth;
        result.datesUpdated += 1;
      }
      if (newDate <= now) {
        existing.status = ExpenseStatus.PAID;
      }

      if (options.amountOrLabelChanging) {
        const isCustomized = this.isExpenseCustomized(existing, plan);
        if (!isCustomized) {
          existing.amount = plan.installmentAmount;
          existing.description = plan.label;
        } else if (
          options.overridePolicy === InstallmentOverridePolicy.REPLACE
        ) {
          existing.amount = plan.installmentAmount;
          existing.description = plan.label;
          existing.overriddenFields = [];
          result.overridesReplaced += 1;
        } else {
          result.overridesPreserved += 1;
        }
      }

      await existing.save();
    }

    // Pending occurrences that fell outside the new totalInstallments are
    // removed; paid history and skipped tombstones are never touched.
    await this.expenseModel.deleteMany({
      installmentPlanId: plan._id,
      installmentNumber: { $gt: plan.totalInstallments },
      status: { $ne: ExpenseStatus.PAID },
      skippedAt: { $exists: false },
    });

    return result;
  }

  /**
   * Used from the individual-cuota edit flow (Movimientos/Inicio), not from
   * the plan editor. Two independent, purely informational operations:
   *  - `dayOfMonth`: resync the day-of-month for the target range, keeping
   *    each cuota's own month unchanged.
   *  - `targetYearMonth`: move the anchor cuota (and optionally later ones,
   *    cascading the same delta) to a different month.
   */
  async rescheduleInstallments(
    planId: string,
    rescheduleDto: RescheduleInstallmentDto,
    userId: string,
  ): Promise<{ updated: number }> {
    const plan = await this.installmentPlanModel.findById(planId);
    if (!plan) {
      throw new NotFoundException('Plan de cuotas no encontrado');
    }

    await this.participantsService.ensureParticipantAccess(
      plan.tripId.toString(),
      userId,
    );

    if (
      rescheduleDto.scope === InstallmentRescheduleScope.THIS &&
      rescheduleDto.installmentNumber == null
    ) {
      throw new BadRequestException(
        'installmentNumber es requerido para el alcance "this"',
      );
    }

    if (rescheduleDto.targetYearMonth != null) {
      if (rescheduleDto.scope === InstallmentRescheduleScope.ALL) {
        throw new BadRequestException(
          'targetYearMonth no aplica al alcance "all"',
        );
      }
      if (rescheduleDto.installmentNumber == null) {
        throw new BadRequestException(
          'installmentNumber es requerido para mover el mes de una cuota',
        );
      }
      const updated = await this.applyMonthShift(
        plan,
        rescheduleDto.installmentNumber,
        rescheduleDto.targetYearMonth,
        rescheduleDto.scope,
      );
      this.logger.log(
        `Installment plan ${planId} month-shifted (${rescheduleDto.scope}): ${updated} expense(s) updated`,
      );
      return { updated };
    }

    assertValidDayOfMonth(rescheduleDto.dayOfMonth!);
    const dayOfMonth = rescheduleDto.dayOfMonth!;

    let anchorInstallmentNumber = rescheduleDto.installmentNumber;
    if (
      rescheduleDto.scope === InstallmentRescheduleScope.THIS_AND_FUTURE &&
      anchorInstallmentNumber == null
    ) {
      // No explicit cuota given: resolve live from actual expense state
      // instead of the plan's frozen paidInstallments seed, which goes
      // stale as cuotas get paid automatically over time.
      const pendingExpenses = await this.expenseModel.find({
        installmentPlanId: plan._id,
        status: { $ne: ExpenseStatus.PAID },
        skippedAt: { $exists: false },
      });
      const pendingInstallmentNumbers = pendingExpenses
        .map((expense) => expense.installmentNumber)
        .filter((n): n is number => n != null);
      if (pendingInstallmentNumbers.length === 0) {
        return { updated: 0 };
      }
      anchorInstallmentNumber = Math.min(...pendingInstallmentNumbers);
    }

    if (
      rescheduleDto.scope !== InstallmentRescheduleScope.ALL &&
      anchorInstallmentNumber != null &&
      (anchorInstallmentNumber < 1 ||
        anchorInstallmentNumber > plan.totalInstallments)
    ) {
      throw new BadRequestException('Número de cuota inválido');
    }

    const targetNumbers: number[] = [];
    const from =
      rescheduleDto.scope === InstallmentRescheduleScope.ALL
        ? 1
        : anchorInstallmentNumber!;
    const to =
      rescheduleDto.scope === InstallmentRescheduleScope.THIS
        ? anchorInstallmentNumber!
        : plan.totalInstallments;
    for (let n = from; n <= to; n += 1) targetNumbers.push(n);

    if (rescheduleDto.scope !== InstallmentRescheduleScope.THIS) {
      plan.dayOfMonth = dayOfMonth;
      await plan.save();
    }

    const updated = await this.applyDayToInstallments(
      plan,
      targetNumbers,
      dayOfMonth,
    );
    this.logger.log(
      `Installment plan ${planId} rescheduled (${rescheduleDto.scope}): ${updated} expense(s) updated`,
    );
    return { updated };
  }

  private async applyDayToInstallments(
    plan: InstallmentPlanDocument,
    installmentNumbers: number[],
    dayOfMonth: number,
  ): Promise<number> {
    let updatedCount = 0;
    for (const installmentNumber of installmentNumbers) {
      const occurrenceKey = `installment:${plan._id.toString()}:${installmentNumber}`;
      const expense = await this.expenseModel.findOne({ occurrenceKey });
      // An omitted occurrence keeps its own date; it must not be regenerated.
      if (!expense || expense.skippedAt) continue;

      const yearMonth = shiftYearMonth(
        plan.startYearMonth,
        installmentNumber - 1,
      );
      expense.expenseDate = buildOccurrenceDate(yearMonth, dayOfMonth);

      await expense.save();
      updatedCount += 1;
    }
    return updatedCount;
  }

  /**
   * Moves the anchor cuota to `targetYearMonth`. Scope "this" only moves
   * the anchor; "this_and_future" cascades the same month delta to every
   * later cuota, preserving their relative spacing, but never rewrites
   * paid history beyond the anchor itself and never touches omitted ones.
   */
  private async applyMonthShift(
    plan: InstallmentPlanDocument,
    anchorInstallmentNumber: number,
    targetYearMonth: string,
    scope: InstallmentRescheduleScope,
  ): Promise<number> {
    if (
      anchorInstallmentNumber < 1 ||
      anchorInstallmentNumber > plan.totalInstallments
    ) {
      throw new BadRequestException('Número de cuota inválido');
    }

    const anchorCanonicalMonth = shiftYearMonth(
      plan.startYearMonth,
      anchorInstallmentNumber - 1,
    );
    const deltaMonths = monthsBetweenYearMonths(
      anchorCanonicalMonth,
      targetYearMonth,
    );

    const to =
      scope === InstallmentRescheduleScope.THIS
        ? anchorInstallmentNumber
        : plan.totalInstallments;

    let updatedCount = 0;
    for (let n = anchorInstallmentNumber; n <= to; n += 1) {
      const occurrenceKey = `installment:${plan._id.toString()}:${n}`;
      const expense = await this.expenseModel.findOne({ occurrenceKey });
      if (!expense || expense.skippedAt) continue;
      // Cascading into later cuotas must never rewrite paid history — only
      // the anchor itself (explicitly targeted) is allowed to move if paid.
      if (
        n !== anchorInstallmentNumber &&
        expense.status === ExpenseStatus.PAID
      ) {
        continue;
      }

      const canonicalMonth = shiftYearMonth(plan.startYearMonth, n - 1);
      const newYearMonth = shiftYearMonth(canonicalMonth, deltaMonths);
      expense.expenseDate = buildOccurrenceDate(newYearMonth, plan.dayOfMonth);
      expense.paymentYearMonth = newYearMonth;

      if (
        expense.expenseDate <= new Date() &&
        expense.status !== ExpenseStatus.PAID
      ) {
        expense.status = ExpenseStatus.PAID;
      }

      await expense.save();
      updatedCount += 1;
    }
    return updatedCount;
  }
}
