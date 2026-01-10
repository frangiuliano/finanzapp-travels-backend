import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Expense,
  ExpenseDocument,
  ExpenseStatus,
  SplitType,
  ExpenseSplit,
} from './expense.schema';
import { Budget, BudgetDocument } from '../budgets/budget.schema';
import {
  Participant,
  ParticipantDocument,
} from '../participants/schemas/participant.schema';
import { Trip, TripDocument } from '../trips/trip.schema';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    @InjectModel(Trip.name) private tripModel: Model<TripDocument>,
  ) {}

  async create(
    createExpenseDto: CreateExpenseDto,
    userId: string,
  ): Promise<Expense> {
    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(createExpenseDto.tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este viaje o el viaje no existe',
      );
    }

    let budget: BudgetDocument | null = null;
    if (createExpenseDto.budgetId) {
      budget = await this.budgetModel.findById(createExpenseDto.budgetId);

      if (!budget) {
        throw new NotFoundException('Presupuesto no encontrado');
      }

      if (budget.tripId.toString() !== createExpenseDto.tripId) {
        throw new BadRequestException(
          'El presupuesto no pertenece a este viaje',
        );
      }
    }

    if (
      !createExpenseDto.paidByParticipantId &&
      !createExpenseDto.paidByThirdParty
    ) {
      throw new BadRequestException(
        'Debe especificar quién pagó el gasto (participante o tercero)',
      );
    }

    if (
      createExpenseDto.paidByParticipantId &&
      createExpenseDto.paidByThirdParty
    ) {
      throw new BadRequestException(
        'No puede especificar participante y tercero al mismo tiempo',
      );
    }

    const status =
      createExpenseDto.status ||
      (createExpenseDto.paidByThirdParty
        ? ExpenseStatus.PENDING
        : ExpenseStatus.PAID);

    if (
      status === ExpenseStatus.PENDING &&
      !createExpenseDto.paidByThirdParty
    ) {
      throw new BadRequestException(
        'Un gasto pendiente debe ser pagado por un tercero',
      );
    }

    if (
      status === ExpenseStatus.PAID &&
      !createExpenseDto.paidByParticipantId
    ) {
      throw new BadRequestException(
        'Un gasto pagado debe ser pagado por un participante',
      );
    }

    if (createExpenseDto.paidByParticipantId) {
      const paidByParticipant = await this.participantModel.findOne({
        _id: new Types.ObjectId(createExpenseDto.paidByParticipantId),
        tripId: new Types.ObjectId(createExpenseDto.tripId),
      });

      if (!paidByParticipant) {
        throw new NotFoundException(
          'El participante que pagó no existe o no pertenece a este viaje',
        );
      }
    }

    const isDivisible = createExpenseDto.isDivisible ?? false;

    // Validar lógica de división
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
      // Si no es divisible, no debe tener splits
      if (createExpenseDto.splits && createExpenseDto.splits.length > 0) {
        throw new BadRequestException(
          'Un gasto no divisible no debe tener divisiones',
        );
      }
    }

    const tripParticipants = await this.participantModel.find({
      tripId: new Types.ObjectId(createExpenseDto.tripId),
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
            `El participante ${participantId.toString()} no pertenece a este viaje`,
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

    const expense = new this.expenseModel({
      ...createExpenseDto,
      tripId: new Types.ObjectId(createExpenseDto.tripId),
      budgetId: createExpenseDto.budgetId
        ? new Types.ObjectId(createExpenseDto.budgetId)
        : undefined,
      currency: createExpenseDto.currency || DEFAULT_CURRENCY,
      paidByParticipantId: createExpenseDto.paidByParticipantId
        ? new Types.ObjectId(createExpenseDto.paidByParticipantId)
        : undefined,
      isDivisible,
      splitType: isDivisible ? createExpenseDto.splitType : undefined,
      splits: processedSplits,
      status,
      createdBy: new Types.ObjectId(userId),
      expenseDate,
    });

    const savedExpense = await expense.save();

    if (createExpenseDto.budgetId) {
      await this.updateBudgetSpent(
        createExpenseDto.budgetId,
        savedExpense.amount,
      );
    }

    this.logger.log(
      `Gasto creado: ${savedExpense.description} (${savedExpense.amount} ${savedExpense.currency}) en el viaje ${createExpenseDto.tripId}`,
    );

    return savedExpense;
  }

  async findAll(
    tripId: string,
    userId: string,
    budgetId?: string,
    status?: ExpenseStatus,
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
    } = { tripId: new Types.ObjectId(tripId) };

    if (budgetId) {
      query.budgetId = new Types.ObjectId(budgetId);
    }

    if (status) {
      query.status = status;
    }

    const expenses = await this.expenseModel
      .find(query)
      .populate('paidByParticipantId', 'userId guestName guestEmail')
      .populate('createdBy', 'firstName lastName email')
      .populate('budgetId', 'name')
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean();

    return expenses;
  }

  async findOne(id: string, userId: string): Promise<Expense> {
    const expense = await this.expenseModel
      .findById(id)
      .populate('paidByParticipantId', 'userId guestName guestEmail')
      .populate('splits.participantId', 'userId guestName guestEmail')
      .populate('createdBy', 'firstName lastName email')
      .populate('budgetId', 'name')
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

    return expense;
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

    const userParticipant = await this.participantModel.findOne({
      tripId: expense.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este gasto o el viaje no existe',
      );
    }

    const oldAmount = expense.amount;

    if (updateExpenseDto.budgetId) {
      const budget = await this.budgetModel.findById(updateExpenseDto.budgetId);
      if (!budget) {
        throw new NotFoundException('Presupuesto no encontrado');
      }
      if (budget.tripId.toString() !== expense.tripId.toString()) {
        throw new BadRequestException(
          'El presupuesto no pertenece a este viaje',
        );
      }
    }

    if (
      updateExpenseDto.paidByParticipantId ||
      updateExpenseDto.paidByThirdParty
    ) {
      if (
        updateExpenseDto.paidByParticipantId &&
        updateExpenseDto.paidByThirdParty
      ) {
        throw new BadRequestException(
          'No puede especificar participante y tercero al mismo tiempo',
        );
      }
    }

    const isDivisible =
      updateExpenseDto.isDivisible !== undefined
        ? updateExpenseDto.isDivisible
        : expense.isDivisible;

    const newAmount = updateExpenseDto.amount || expense.amount;
    let processedSplits: ExpenseSplit[] | undefined = expense.splits;

    // Validar lógica de división
    const isChangingDivisibility = expense.isDivisible !== isDivisible;
    const isUpdatingSplits =
      updateExpenseDto.splits !== undefined ||
      updateExpenseDto.splitType !== undefined;

    if (isDivisible) {
      // Si cambió a divisible o se están actualizando splits, debe tener splits válidos
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

        // Validar que los participantes pertenezcan al viaje
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
        // No se está actualizando la división, mantener la actual
        if (!expense.splits || expense.splits.length === 0) {
          throw new BadRequestException(
            'Un gasto divisible debe tener divisiones',
          );
        }
        // Mantener splits existentes pero recalcular si cambió el monto
        if (updateExpenseDto.amount !== undefined) {
          // Si cambió el monto, recalcular splits proporcionalmente
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
      // Si no es divisible, no debe tener splits
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

    Object.assign(expense, {
      ...updateExpenseDto,
      budgetId:
        updateExpenseDto.budgetId !== undefined
          ? updateExpenseDto.budgetId
            ? new Types.ObjectId(updateExpenseDto.budgetId)
            : undefined
          : expense.budgetId,
      paidByParticipantId: updateExpenseDto.paidByParticipantId
        ? new Types.ObjectId(updateExpenseDto.paidByParticipantId)
        : expense.paidByParticipantId,
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

    // Actualizar spent del budget solo si hay cambios en amount o budgetId
    if (
      updateExpenseDto.amount !== undefined ||
      updateExpenseDto.budgetId !== undefined
    ) {
      // Revertir el spent del budget anterior
      if (expense.budgetId) {
        await this.updateBudgetSpent(expense.budgetId.toString(), -oldAmount);
      }

      // Actualizar el spent del nuevo budget (o el mismo si no cambió)
      if (updatedExpense.budgetId) {
        await this.updateBudgetSpent(
          updatedExpense.budgetId.toString(),
          updatedExpense.amount,
        );
      }
    }

    this.logger.log(`Gasto actualizado: ${id}`);

    return updatedExpense;
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

    const amount = expense.amount;

    await this.expenseModel.findByIdAndDelete(id);

    if (expense.budgetId) {
      const budgetId = expense.budgetId.toString();
      await this.updateBudgetSpent(budgetId, -amount);
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
        'No tienes acceso a este viaje o el viaje no existe',
      );
    }

    const expenses = await this.expenseModel
      .find({ tripId: new Types.ObjectId(tripId) })
      .populate('budgetId', 'name')
      .populate('paidByParticipantId', 'userId guestName')
      .lean();

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    const budgetMap = new Map<string, { name: string; total: number }>();
    expenses.forEach((exp) => {
      if (!exp.budgetId) {
        // Gastos sin presupuesto se agrupan como "Sin presupuesto"
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
    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException(
        'No tienes acceso a este viaje o el viaje no existe',
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

  async settleExpense(id: string, userId: string): Promise<Expense> {
    const expense = await this.expenseModel.findById(id);

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    if (expense.status === ExpenseStatus.PAID) {
      throw new BadRequestException('Este gasto ya está marcado como pagado');
    }

    if (!expense.paidByThirdParty) {
      throw new BadRequestException(
        'Solo los gastos pagados por terceros pueden ser saldados',
      );
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

    expense.status = ExpenseStatus.PAID;
    expense.updatedAt = new Date();
    const updatedExpense = await expense.save();

    this.logger.log(`Gasto marcado como saldado: ${id}`);

    return updatedExpense;
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
}
