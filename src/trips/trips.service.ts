import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
  Logger,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Board, BoardDocument, BoardType } from './board.schema';
import {
  Participant,
  ParticipantDocument,
  ParticipantRole,
} from '../participants/schemas/participant.schema';
import { Budget, BudgetDocument } from '../budgets/budget.schema';
import {
  Invitation,
  InvitationDocument,
} from '../participants/schemas/invitation.schema';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';
import { CategoriesService } from '../categories/categories.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { Income, IncomeDocument } from '../incomes/income.schema';
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
import {
  InstallmentPlan,
  InstallmentPlanDocument,
} from '../installment-plans/installment-plan.schema';
import {
  BoardMonthBudget,
  BoardMonthBudgetDocument,
} from '../board-month-budgets/board-month-budget.schema';
import { Card, CardDocument } from '../cards/card.schema';
import { User, UserDocument } from '../users/user.schema';
import { BotUpdate, BotUpdateDocument } from '../bot/bot-update.schema';
import {
  PaymentMethod,
  PaymentMethodDocument,
  PaymentMethodOwnerType,
} from '../payment-methods/payment-method.schema';
import {
  BillingPeriod,
  BillingPeriodDocument,
} from '../billing-periods/billing-period.schema';
import {
  InAppNotification,
  InAppNotificationDocument,
} from '../in-app-notifications/in-app-notification.schema';

@Injectable()
export class BoardsService implements OnModuleInit {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    @InjectModel(Expense.name) private expenseModel: Model<ExpenseDocument>,
    @InjectModel(Income.name) private incomeModel: Model<IncomeDocument>,
    @InjectModel(RecurringIncome.name)
    private recurringIncomeModel: Model<RecurringIncomeDocument>,
    @InjectModel(RecurringIncomeVersion.name)
    private recurringIncomeVersionModel: Model<RecurringIncomeVersionDocument>,
    @InjectModel(RecurringExpense.name)
    private recurringExpenseModel: Model<RecurringExpenseDocument>,
    @InjectModel(RecurringExpenseVersion.name)
    private recurringExpenseVersionModel: Model<RecurringExpenseVersionDocument>,
    @InjectModel(InstallmentPlan.name)
    private installmentPlanModel: Model<InstallmentPlanDocument>,
    @InjectModel(BoardMonthBudget.name)
    private boardMonthBudgetModel: Model<BoardMonthBudgetDocument>,
    @InjectModel(Card.name) private cardModel: Model<CardDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(BotUpdate.name)
    private botUpdateModel: Model<BotUpdateDocument>,
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethodDocument>,
    @InjectModel(BillingPeriod.name)
    private billingPeriodModel: Model<BillingPeriodDocument>,
    @InjectModel(InAppNotification.name)
    private inAppNotificationModel: Model<InAppNotificationDocument>,
    @Inject(forwardRef(() => CategoriesService))
    private categoriesService: CategoriesService,
    @Inject(forwardRef(() => PaymentMethodsService))
    private paymentMethodsService: PaymentMethodsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const result = await this.boardModel.updateMany(
      { type: { $exists: false } },
      { $set: { type: BoardType.TRAVEL } },
    );
    if (result.modifiedCount > 0) {
      this.logger.log(
        `Backfilled type=travel on ${result.modifiedCount} existing board(s)`,
      );
    }

    await this.backfillTravelParentBoards();
    await this.migrateLegacyTravelParentLinks();
  }

  async create(createBoardDto: CreateBoardDto, userId: string): Promise<Board> {
    const type = createBoardDto.type ?? BoardType.TRAVEL;
    const parentBoardId = await this.resolveParentBoardId(
      type,
      createBoardDto.parentBoardId,
      userId,
    );
    const parentBoard = parentBoardId
      ? await this.boardModel.findById(parentBoardId)
      : null;
    if (
      parentBoard &&
      createBoardDto.baseCurrency &&
      createBoardDto.baseCurrency !== parentBoard.baseCurrency
    ) {
      throw new BadRequestException(
        'La moneda base del viaje debe coincidir con la del tablero principal',
      );
    }
    const board = new this.boardModel({
      name: createBoardDto.name,
      baseCurrency:
        createBoardDto.baseCurrency ||
        parentBoard?.baseCurrency ||
        DEFAULT_CURRENCY,
      type,
      parentBoardId,
      createdBy: new Types.ObjectId(userId),
    });

    const savedBoard = await board.save();

    await this.participantModel.create({
      tripId: savedBoard._id,
      userId: new Types.ObjectId(userId),
      role: ParticipantRole.OWNER,
      linkedEverydayBoardId: parentBoardId,
    });

    const boardId = savedBoard._id.toString();
    await this.categoriesService.seedDefaults(
      boardId,
      createBoardDto.categoryNames,
    );
    await this.paymentMethodsService.seedDefaults(boardId);

    return savedBoard;
  }

  async findAll(
    userId: string,
  ): Promise<(Board & { userRole: ParticipantRole })[]> {
    const participants = await this.participantModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('tripId role linkedEverydayBoardId')
      .lean();

    const boardIds = participants.map((p) => p.tripId);

    if (boardIds.length === 0) {
      return [];
    }

    const boards = await this.boardModel
      .find({ _id: { $in: boardIds }, archivedAt: { $exists: false } })
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    return boards.map((board) => {
      const participant = participants.find(
        (p) => p.tripId.toString() === board._id.toString(),
      );
      return {
        ...board,
        type: board.type ?? BoardType.TRAVEL,
        userRole: participant?.role || ParticipantRole.MEMBER,
        linkedEverydayBoardId: participant?.linkedEverydayBoardId?.toString(),
      };
    });
  }

  async findArchived(
    userId: string,
  ): Promise<(Board & { userRole: ParticipantRole })[]> {
    const participants = await this.participantModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('tripId role linkedEverydayBoardId')
      .lean();
    if (participants.length === 0) return [];

    const boards = await this.boardModel
      .find({
        _id: { $in: participants.map((item) => item.tripId) },
        archivedAt: { $exists: true },
      })
      .populate('createdBy', 'firstName lastName email')
      .sort({ archivedAt: -1 })
      .lean();

    return boards.map((board) => ({
      ...board,
      type: board.type ?? BoardType.TRAVEL,
      userRole:
        participants.find(
          (item) => item.tripId.toString() === board._id.toString(),
        )?.role ?? ParticipantRole.MEMBER,
    }));
  }

  async setArchived(id: string, userId: string, archived: boolean) {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!participant || participant.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException(
        'Solo el propietario puede archivar el tablero',
      );
    }
    const board = await this.boardModel.findById(id);
    if (!board) throw new NotFoundException('Tablero no encontrado');
    if (board.type === BoardType.EVERYDAY) {
      throw new BadRequestException(
        'El tablero principal no se puede archivar',
      );
    }
    board.archivedAt = archived ? new Date() : undefined;
    await board.save();
    return this.findOne(id, userId);
  }

  async findOne(
    id: string,
    userId: string,
  ): Promise<
    Board & {
      userRole: ParticipantRole;
      linkedEverydayBoardId?: string;
    }
  > {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Tablero no encontrado o no tienes acceso');
    }

    const board = await this.boardModel
      .findById(id)
      .populate('createdBy', 'firstName lastName email')
      .lean();

    if (!board) {
      throw new NotFoundException('Tablero no encontrado');
    }

    return {
      ...board,
      type: board.type ?? BoardType.TRAVEL,
      userRole: participant.role,
      linkedEverydayBoardId: participant.linkedEverydayBoardId?.toString(),
    };
  }

  async findByIdOrFail(id: string): Promise<BoardDocument> {
    const board = await this.boardModel.findById(id);

    if (!board) {
      throw new NotFoundException('Tablero no encontrado');
    }

    if (!board.type) {
      board.type = BoardType.TRAVEL;
    }

    return board;
  }

  async findExpenseScope(
    boardId: string,
    userId: string,
  ): Promise<BoardDocument[]> {
    const context = await this.findExpenseScopeContext(boardId, userId);
    return context.map((item) => item.board);
  }

  async findExpenseScopeContext(
    boardId: string,
    userId: string,
  ): Promise<Array<{ board: BoardDocument; participantId: Types.ObjectId }>> {
    const board = await this.findByIdOrFail(boardId);
    const participant = await this.participantModel.findOne({
      tripId: board._id,
      userId: new Types.ObjectId(userId),
    });
    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este tablero o el tablero no existe',
      );
    }
    const ownContext = {
      board,
      participantId: participant._id,
    };
    if (board.type !== BoardType.EVERYDAY) return [ownContext];

    const linkedParticipants = await this.participantModel.find({
      userId: new Types.ObjectId(userId),
      linkedEverydayBoardId: board._id,
      tripId: { $ne: board._id },
    });
    if (linkedParticipants.length === 0) return [ownContext];
    const participantByBoardId = new Map(
      linkedParticipants.map((item) => [item.tripId.toString(), item]),
    );
    const children = await this.boardModel.find({
      _id: { $in: linkedParticipants.map((item) => item.tripId) },
      type: BoardType.TRAVEL,
    });
    return [
      ownContext,
      ...children.map((child) => ({
        board: child,
        participantId: participantByBoardId.get(child._id.toString())!._id,
      })),
    ];
  }

  async updateExpenseLink(
    travelBoardId: string,
    everydayBoardId: string | null,
    userId: string,
  ): Promise<
    Board & {
      userRole: ParticipantRole;
      linkedEverydayBoardId?: string;
    }
  > {
    const travel = await this.assertTravelFeatures(travelBoardId);
    const participant = await this.participantModel.findOne({
      tripId: travel._id,
      userId: new Types.ObjectId(userId),
    });
    if (!participant) {
      throw new ForbiddenException('No tienes acceso a este viaje');
    }

    if (!everydayBoardId) {
      participant.linkedEverydayBoardId = undefined;
      await participant.save();
      return this.findOne(travelBoardId, userId);
    }

    const everyday = await this.assertEverydayFeatures(everydayBoardId);
    const everydayParticipant = await this.participantModel.findOne({
      tripId: everyday._id,
      userId: new Types.ObjectId(userId),
    });
    if (!everydayParticipant) {
      throw new ForbiddenException(
        'Solo puedes vincular el viaje a un tablero cotidiano al que perteneces',
      );
    }
    if (travel.baseCurrency !== everyday.baseCurrency) {
      throw new BadRequestException(
        'La moneda base del viaje debe coincidir con la del tablero cotidiano',
      );
    }
    participant.linkedEverydayBoardId = everyday._id;
    await participant.save();
    return this.findOne(travelBoardId, userId);
  }

  private async resolveParentBoardId(
    type: BoardType,
    requestedParentId: string | undefined,
    userId: string,
  ): Promise<Types.ObjectId | undefined> {
    if (type === BoardType.EVERYDAY) {
      if (requestedParentId) {
        throw new BadRequestException(
          'Un tablero cotidiano no puede tener tablero principal',
        );
      }
      return undefined;
    }

    const candidate = requestedParentId
      ? await this.boardModel.findOne({
          _id: new Types.ObjectId(requestedParentId),
          type: BoardType.EVERYDAY,
          createdBy: new Types.ObjectId(userId),
        })
      : await this.boardModel.findOne({
          type: BoardType.EVERYDAY,
          createdBy: new Types.ObjectId(userId),
        });
    if (requestedParentId && !candidate) {
      throw new BadRequestException(
        'El tablero principal debe ser un tablero cotidiano propio',
      );
    }
    return candidate?._id;
  }

  private async backfillTravelParentBoards(): Promise<void> {
    const everydayBoards = await this.boardModel
      .find({ type: BoardType.EVERYDAY })
      .select('_id createdBy baseCurrency')
      .lean();
    const byCreator = new Map<string, Types.ObjectId[]>();
    for (const board of everydayBoards) {
      const creatorId = board.createdBy.toString();
      byCreator.set(creatorId, [
        ...(byCreator.get(creatorId) ?? []),
        board._id,
      ]);
    }
    for (const [creatorId, parents] of byCreator) {
      if (parents.length !== 1) continue;
      await this.boardModel.updateMany(
        {
          type: BoardType.TRAVEL,
          createdBy: new Types.ObjectId(creatorId),
          parentBoardId: { $exists: false },
          baseCurrency: everydayBoards.find((board) =>
            board._id.equals(parents[0]),
          )!.baseCurrency,
        },
        { $set: { parentBoardId: parents[0] } },
      );
    }
  }

  private async migrateLegacyTravelParentLinks(): Promise<void> {
    const legacyLinks = await this.boardModel
      .find({
        type: BoardType.TRAVEL,
        parentBoardId: { $exists: true },
      })
      .select('_id createdBy parentBoardId')
      .lean();
    for (const travel of legacyLinks) {
      await this.participantModel.updateOne(
        {
          tripId: travel._id,
          userId: travel.createdBy,
          linkedEverydayBoardId: { $exists: false },
        },
        { $set: { linkedEverydayBoardId: travel.parentBoardId } },
      );
    }
  }

  async assertTravelFeatures(boardId: string): Promise<BoardDocument> {
    const board = await this.findByIdOrFail(boardId);

    if (board.type !== BoardType.TRAVEL) {
      throw new ForbiddenException(
        'Esta operación solo está disponible en tableros de tipo travel',
      );
    }

    return board;
  }

  async assertEverydayFeatures(boardId: string): Promise<BoardDocument> {
    const board = await this.findByIdOrFail(boardId);

    if (board.type !== BoardType.EVERYDAY) {
      throw new ForbiddenException(
        'Esta operación solo está disponible en tableros de tipo everyday',
      );
    }

    return board;
  }

  async isTravelBoard(boardId: string): Promise<boolean> {
    const board = await this.findByIdOrFail(boardId);
    return board.type === BoardType.TRAVEL;
  }

  async isEverydayBoard(boardId: string): Promise<boolean> {
    const board = await this.findByIdOrFail(boardId);
    return board.type === BoardType.EVERYDAY;
  }

  async update(
    id: string,
    updateBoardDto: UpdateBoardDto,
    userId: string,
  ): Promise<Board> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Tablero no encontrado o no tienes acceso');
    }

    if (participant.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException(
        'Solo el propietario del tablero puede actualizarlo',
      );
    }

    const board = await this.boardModel.findById(id);

    if (!board) {
      throw new NotFoundException('Tablero no encontrado');
    }

    if (
      updateBoardDto.type !== undefined &&
      updateBoardDto.type !== (board.type ?? BoardType.TRAVEL)
    ) {
      throw new BadRequestException(
        'No se puede cambiar el tipo de tablero después de crearlo. Creá un tablero nuevo con el tipo deseado.',
      );
    }

    const { type: _type, ...safeUpdate } = updateBoardDto;
    void _type;
    Object.assign(board, safeUpdate);
    const updatedBoard = await board.save();

    return updatedBoard.populate('createdBy', 'firstName lastName email');
  }

  async remove(id: string, userId: string): Promise<void> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Tablero no encontrado o no tienes acceso');
    }

    if (participant.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException(
        'Solo el propietario del tablero puede eliminarlo',
      );
    }

    const board = await this.boardModel.findById(id);

    if (!board) {
      throw new NotFoundException('Tablero no encontrado');
    }

    const boardId = new Types.ObjectId(id);

    const [
      recurringIncomes,
      recurringExpenses,
      boardPaymentMethods,
      legacyBoardCards,
    ] = await Promise.all([
      this.recurringIncomeModel.find({ tripId: boardId }).select('_id').lean(),
      this.recurringExpenseModel.find({ tripId: boardId }).select('_id').lean(),
      this.paymentMethodModel
        .find({ ownerType: PaymentMethodOwnerType.BOARD, tripId: boardId })
        .select('_id')
        .lean(),
      this.cardModel.find({ tripId: boardId }).select('_id').lean(),
    ]);
    const recurringIncomeIds = recurringIncomes.map((item) => item._id);
    const recurringExpenseIds = recurringExpenses.map((item) => item._id);
    const boardPaymentMethodIds = boardPaymentMethods.map((item) => item._id);
    const legacyBoardCardIds = legacyBoardCards.map((item) => item._id);

    // Old data may reference a board-owned method from a different board.
    // Preserve those movements/rules but remove the soon-to-be-invalid link.
    await Promise.all([
      this.expenseModel.updateMany(
        {
          tripId: { $ne: boardId },
          $or: [
            { paymentMethodId: { $in: boardPaymentMethodIds } },
            {
              cardId: {
                $in: [...boardPaymentMethodIds, ...legacyBoardCardIds],
              },
            },
          ],
        },
        { $unset: { paymentMethodId: 1, cardId: 1 } },
      ),
      this.recurringExpenseModel.updateMany(
        {
          tripId: { $ne: boardId },
          paymentMethodId: { $in: boardPaymentMethodIds },
        },
        { $unset: { paymentMethodId: 1 } },
      ),
      this.installmentPlanModel.updateMany(
        {
          tripId: { $ne: boardId },
          paymentMethodId: { $in: boardPaymentMethodIds },
        },
        { $unset: { paymentMethodId: 1 } },
      ),
    ]);

    await Promise.all([
      this.recurringIncomeVersionModel.deleteMany({
        recurringIncomeId: { $in: recurringIncomeIds },
      }),
      this.recurringExpenseVersionModel.deleteMany({
        recurringExpenseId: { $in: recurringExpenseIds },
      }),
      this.expenseModel.deleteMany({ tripId: boardId }),
      this.incomeModel.deleteMany({ tripId: boardId }),
      this.installmentPlanModel.deleteMany({ tripId: boardId }),
      this.boardMonthBudgetModel.deleteMany({ tripId: boardId }),
      this.budgetModel.deleteMany({ tripId: boardId }),
      this.cardModel.deleteMany({ tripId: boardId }),
      this.participantModel.deleteMany({ tripId: boardId }),
      this.invitationModel.deleteMany({ tripId: boardId }),
      this.billingPeriodModel.deleteMany({
        paymentMethodId: { $in: boardPaymentMethodIds },
      }),
      this.inAppNotificationModel.deleteMany({
        'payload.paymentMethodId': {
          $in: boardPaymentMethodIds.flatMap((methodId) => [
            methodId,
            methodId.toString(),
          ]),
        },
      }),
    ]);
    await Promise.all([
      this.recurringIncomeModel.deleteMany({ tripId: boardId }),
      this.recurringExpenseModel.deleteMany({ tripId: boardId }),
      this.categoriesService.deleteByBoard(id),
      this.paymentMethodsService.deleteByBoard(id),
    ]);

    // Travel boards are independent records: removing an everyday board only
    // detaches its children instead of deleting their history. This final
    // phase runs after the idempotent cleanup so a failed cleanup can be
    // safely retried while the board and its links still exist.
    await Promise.all([
      this.boardModel.updateMany(
        { parentBoardId: boardId },
        { $unset: { parentBoardId: 1 } },
      ),
      this.participantModel.updateMany(
        { linkedEverydayBoardId: boardId },
        { $unset: { linkedEverydayBoardId: 1 } },
      ),
      this.userModel.updateMany(
        { activeBoardId: boardId },
        { $set: { activeBoardId: null } },
      ),
      this.botUpdateModel.updateMany(
        { currentTripId: boardId },
        {
          $set: { state: 'idle' },
          $unset: { currentTripId: 1, pendingExpense: 1 },
        },
      ),
    ]);
    await this.boardModel.findByIdAndDelete(id);
  }
}

/** @deprecated Use BoardsService */
export { BoardsService as TripsService };
