import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AdjustHoldingBalanceDto,
  CreateHoldingDto,
  UpdateHoldingDto,
  CreateInstrumentDto,
  CreateInvestmentTransactionDto,
  CreatePositionDto,
  UpdatePositionPriceDto,
  UpdateInvestmentTransactionDto,
} from './wealth.dto';
import {
  Holding,
  HoldingDocument,
  HoldingType,
  WealthEvent,
  WealthEventDocument,
  WealthEventKind,
  FinancialInstrument,
  FinancialInstrumentDocument,
  InvestmentPosition,
  InvestmentPositionDocument,
  InvestmentTransaction,
  InvestmentTransactionDocument,
  InvestmentTransactionType,
} from './wealth.schemas';
import { DEFAULT_INSTRUMENTS } from './default-instruments';
import { ParticipantsService } from '../participants/participants.service';
import { Board, BoardDocument } from '../trips/board.schema';
import { User, UserDocument } from '../users/user.schema';
import { MarketDataService } from './market-data.service';

@Injectable()
export class WealthService implements OnModuleInit {
  constructor(
    @InjectModel(Holding.name) private holdingModel: Model<HoldingDocument>,
    @InjectModel(WealthEvent.name)
    private eventModel: Model<WealthEventDocument>,
    @InjectModel(FinancialInstrument.name)
    private instrumentModel: Model<FinancialInstrumentDocument>,
    @InjectModel(InvestmentPosition.name)
    private positionModel: Model<InvestmentPositionDocument>,
    @InjectModel(InvestmentTransaction.name)
    private transactionModel: Model<InvestmentTransactionDocument>,
    @InjectModel(Board.name) private boardModel: Model<BoardDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private participantsService: ParticipantsService,
    private marketDataService: MarketDataService,
  ) {}

  async onModuleInit() {
    await Promise.all(
      DEFAULT_INSTRUMENTS.map(([symbol, name, type, currency, exchange]) =>
        this.instrumentModel.updateOne(
          { symbol, exchange },
          {
            $setOnInsert: {
              symbol,
              name,
              type,
              currency,
              exchange,
              isSystem: true,
              isActive: true,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async getOverview(userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const boardObjectId = new Types.ObjectId(boardId);
    const [holdings, recentEvents] = await Promise.all([
      this.holdingModel
        .find({ boardId: boardObjectId, isActive: true })
        .sort({ createdAt: 1 })
        .lean(),
      this.eventModel
        .find({ boardId: boardObjectId })
        .sort({ occurredAt: -1 })
        .limit(30)
        .lean(),
    ]);
    const [investmentPositions, investmentTransactions] = await Promise.all([
      this.positionModel
        .find({ boardId: boardObjectId, isOpen: true })
        .populate('instrumentId')
        .lean(),
      this.transactionModel
        .find({ boardId: boardObjectId, isVoided: { $ne: true } })
        .sort({ occurredAt: -1 })
        .limit(100)
        .lean(),
    ]);

    return {
      holdings: holdings.map((holding) => ({
        ...holding,
        availableBalance: holding.currentBalance - holding.allocatedBalance,
      })),
      totalsByCurrency: this.buildTotalsByCurrency(
        holdings as unknown as Array<Record<string, unknown>>,
      ),
      recentEvents,
      investmentPositions,
      investmentTransactions,
    };
  }

  async createHolding(dto: CreateHoldingDto, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const ownerId = new Types.ObjectId(userId);
    const boardObjectId = new Types.ObjectId(boardId);
    const holding = await new this.holdingModel({
      ...dto,
      name: dto.name.trim(),
      institution: dto.institution?.trim() || undefined,
      userId: ownerId,
      boardId: boardObjectId,
      allocatedBalance: 0,
      cashBalance:
        dto.type === HoldingType.INVESTMENT ? dto.currentBalance : undefined,
      isActive: true,
    }).save();
    await this.eventModel.create({
      userId: ownerId,
      boardId: boardObjectId,
      holdingId: holding._id,
      kind: WealthEventKind.INITIAL_BALANCE,
      amount: dto.currentBalance,
      balanceAfter: dto.currentBalance,
      occurredAt: new Date(),
    });
    return holding;
  }

  async updateHolding(
    id: string,
    dto: UpdateHoldingDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    if (dto.name !== undefined) holding.name = dto.name.trim();
    if (dto.type !== undefined) holding.type = dto.type;
    if (dto.institution !== undefined) {
      holding.institution = dto.institution.trim() || undefined;
    }
    return holding.save();
  }

  async adjustBalance(
    id: string,
    dto: AdjustHoldingBalanceDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    const previousBalance = holding.currentBalance;
    if (holding.type === HoldingType.INVESTMENT) {
      holding.cashBalance = dto.balance;
      await this.recalculateInvestmentHolding(holding);
    } else {
      holding.currentBalance = dto.balance;
    }
    if (holding.currentBalance < holding.allocatedBalance) {
      throw new BadRequestException(
        `No podés bajar el saldo por debajo de lo asignado (${holding.allocatedBalance} ${holding.currency})`,
      );
    }
    if (holding.type !== HoldingType.INVESTMENT) await holding.save();
    const delta = holding.currentBalance - previousBalance;
    await this.eventModel.create({
      userId: holding.userId,
      boardId: holding.boardId,
      holdingId: holding._id,
      kind: WealthEventKind.BALANCE_ADJUSTMENT,
      amount: delta,
      balanceAfter: holding.currentBalance,
      note: dto.note?.trim() || undefined,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    return holding;
  }

  async archiveHolding(id: string, userId: string, boardId: string) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireHolding(id, boardId);
    if (holding.allocatedBalance > 0) {
      throw new BadRequestException(
        'Liberá primero el dinero asignado a objetivos',
      );
    }
    holding.isActive = false;
    return holding.save();
  }

  async listInstruments(userId: string, search = '', currency?: string) {
    const ownerId = new Types.ObjectId(userId);
    const access = [{ isSystem: true }, { createdBy: ownerId }];
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const external = await this.marketDataService.search(search, currency);
    if (external.length) {
      await this.instrumentModel.bulkWrite(
        external.map((instrument) => ({
          updateOne: {
            filter: {
              symbol: instrument.symbol,
              exchange: instrument.exchange,
            },
            update: {
              $set: {
                name: instrument.name,
                type: instrument.type,
                currency: instrument.currency,
                micCode: instrument.micCode,
                provider: instrument.provider,
                providerSymbol: instrument.providerSymbol,
                isActive: true,
              },
              $setOnInsert: { isSystem: true },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    }
    return this.instrumentModel
      .find({
        isActive: true,
        $and: [
          { $or: access },
          ...(currency ? [{ currency: currency.toUpperCase() }] : []),
          ...(escaped
            ? [
                {
                  $or: [
                    { symbol: { $regex: escaped, $options: 'i' } },
                    { name: { $regex: escaped, $options: 'i' } },
                  ],
                },
              ]
            : []),
        ],
      })
      .sort({ symbol: 1 })
      .limit(100)
      .lean();
  }

  async refreshPositionPrice(
    positionId: string,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const position = await this.positionModel.findOne({
      _id: new Types.ObjectId(positionId),
      boardId: new Types.ObjectId(boardId),
      isOpen: true,
    });
    if (!position) throw new NotFoundException('Posición no encontrada');
    const instrument = await this.instrumentModel.findById(
      position.instrumentId,
    );
    if (!instrument?.providerSymbol || instrument.provider !== 'twelve_data') {
      throw new BadRequestException(
        'Este instrumento no tiene cotización automática disponible',
      );
    }
    try {
      const price = await this.marketDataService.getLatestPrice(
        instrument.providerSymbol,
        instrument.exchange,
      );
      const capturedAt = new Date();
      position.currentPrice = price;
      instrument.lastPrice = price;
      instrument.lastPriceAt = capturedAt;
      await Promise.all([position.save(), instrument.save()]);
      const holding = await this.requireInvestmentHolding(
        position.holdingId.toString(),
        boardId,
      );
      await this.recalculateInvestmentHolding(holding);
      return { currentPrice: price, capturedAt };
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error
          ? `No se pudo obtener la cotización: ${error.message}`
          : 'No se pudo obtener la cotización',
      );
    }
  }

  async createInstrument(dto: CreateInstrumentDto, userId: string) {
    try {
      return await new this.instrumentModel({
        ...dto,
        symbol: dto.symbol.trim().toUpperCase(),
        name: dto.name.trim(),
        exchange: dto.exchange?.trim().toUpperCase() || 'CUSTOM',
        isSystem: false,
        isActive: true,
        createdBy: new Types.ObjectId(userId),
      }).save();
    } catch {
      throw new BadRequestException('Ese instrumento ya existe');
    }
  }

  async createPosition(
    holdingId: string,
    dto: CreatePositionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireInvestmentHolding(holdingId, boardId);
    const instrument = await this.instrumentModel.findOne({
      _id: new Types.ObjectId(dto.instrumentId),
      $or: [{ isSystem: true }, { createdBy: new Types.ObjectId(userId) }],
    });
    if (!instrument) throw new NotFoundException('Instrumento no encontrado');
    if (instrument.currency !== holding.currency) {
      throw new BadRequestException(
        'El instrumento y la cuenta deben usar la misma moneda',
      );
    }
    const existing = await this.positionModel.findOne({
      holdingId: holding._id,
      instrumentId: instrument._id,
    });
    if (existing?.isOpen)
      throw new BadRequestException('La posición ya existe');
    const position = existing
      ? Object.assign(existing, {
          quantity: dto.quantity,
          averageCost: dto.unitPrice,
          currentPrice: dto.unitPrice,
          isOpen: true,
        })
      : new this.positionModel({
          userId: holding.userId,
          boardId: holding.boardId,
          holdingId: holding._id,
          instrumentId: instrument._id,
          quantity: dto.quantity,
          averageCost: dto.unitPrice,
          currentPrice: dto.unitPrice,
          isOpen: true,
        });
    const total = dto.quantity * dto.unitPrice;
    const cash = await this.ensureInvestmentCashBalance(holding);
    if (cash < total) {
      throw new BadRequestException(
        `El efectivo disponible no alcanza. Disponible: ${cash} ${holding.currency}`,
      );
    }
    holding.cashBalance = cash - total;
    await position.save();
    await this.transactionModel.create({
      userId: holding.userId,
      boardId: holding.boardId,
      holdingId: holding._id,
      instrumentId: instrument._id,
      type: InvestmentTransactionType.BUY,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      fees: 0,
      occurredAt: new Date(),
    });
    await this.recalculateInvestmentHolding(holding);
    return position;
  }

  async updatePositionPrice(
    positionId: string,
    dto: UpdatePositionPriceDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const position = await this.positionModel.findOne({
      _id: new Types.ObjectId(positionId),
      boardId: new Types.ObjectId(boardId),
    });
    if (!position) throw new NotFoundException('Posición no encontrada');
    position.currentPrice = dto.currentPrice;
    await position.save();
    const holding = await this.requireInvestmentHolding(
      position.holdingId.toString(),
      boardId,
    );
    await this.recalculateInvestmentHolding(holding);
    return position;
  }

  async trade(
    holdingId: string,
    dto: CreateInvestmentTransactionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const holding = await this.requireInvestmentHolding(holdingId, boardId);
    const position = await this.positionModel.findOne({
      holdingId: holding._id,
      instrumentId: new Types.ObjectId(dto.instrumentId),
      isOpen: true,
    });
    if (!position) throw new NotFoundException('Posición no encontrada');
    const fees = dto.fees ?? 0;
    const cash = await this.ensureInvestmentCashBalance(holding);
    if (dto.type === InvestmentTransactionType.BUY) {
      const total = dto.quantity * dto.unitPrice + fees;
      if (cash < total)
        throw new BadRequestException(
          `El efectivo disponible no alcanza. Disponible: ${cash} ${holding.currency}`,
        );
      const previousCost = position.quantity * position.averageCost;
      position.quantity += dto.quantity;
      position.averageCost =
        (previousCost + dto.quantity * dto.unitPrice + fees) /
        position.quantity;
      holding.cashBalance = cash - total;
    } else {
      if (dto.quantity > position.quantity) {
        throw new BadRequestException(
          'No hay nominales suficientes para vender',
        );
      }
      const resultingCash = cash + dto.quantity * dto.unitPrice - fees;
      if (resultingCash < 0) {
        throw new BadRequestException(
          'Las comisiones superan el efectivo y el importe de la venta',
        );
      }
      position.quantity -= dto.quantity;
      position.isOpen = position.quantity > 0;
      holding.cashBalance = resultingCash;
    }
    await position.save();
    await this.transactionModel.create({
      ...dto,
      userId: holding.userId,
      boardId: holding.boardId,
      holdingId: holding._id,
      instrumentId: position.instrumentId,
      fees,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    await this.recalculateInvestmentHolding(holding);
    return this.getOverview(userId, boardId);
  }

  async updateTransaction(
    transactionId: string,
    dto: UpdateInvestmentTransactionDto,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const transaction = await this.transactionModel.findOne({
      _id: new Types.ObjectId(transactionId),
      boardId: new Types.ObjectId(boardId),
      isVoided: { $ne: true },
    });
    if (!transaction) throw new NotFoundException('Operación no encontrada');
    const holding = await this.requireInvestmentHolding(
      transaction.holdingId.toString(),
      boardId,
    );
    const instrument = await this.instrumentModel.findOne({
      _id: new Types.ObjectId(dto.instrumentId),
      $or: [{ isSystem: true }, { createdBy: new Types.ObjectId(userId) }],
    });
    if (!instrument) throw new NotFoundException('Instrumento no encontrado');
    if (instrument.currency !== holding.currency) {
      throw new BadRequestException(
        'El instrumento y la cuenta deben usar la misma moneda',
      );
    }
    const oldInstrumentId = transaction.instrumentId.toString();
    const oldCashEffect = this.transactionCashEffect(transaction);
    const replacement = {
      _id: transaction._id,
      instrumentId: instrument._id,
      type: dto.type,
      quantity: dto.quantity,
      unitPrice: dto.unitPrice,
      fees: dto.fees ?? 0,
      occurredAt: dto.occurredAt
        ? new Date(dto.occurredAt)
        : transaction.occurredAt,
    };
    const newCash =
      (await this.ensureInvestmentCashBalance(holding)) -
      oldCashEffect +
      this.transactionCashEffect(replacement);
    if (newCash < 0) {
      throw new BadRequestException(
        'La corrección dejaría el efectivo disponible en negativo',
      );
    }
    const affectedIds = [...new Set([oldInstrumentId, dto.instrumentId])];
    const states = await Promise.all(
      affectedIds.map((id) =>
        this.replayInstrumentTransactions(holding._id, id, replacement),
      ),
    );
    transaction.correctionHistory ??= [];
    transaction.correctionHistory.push({
      action: 'updated',
      correctedAt: new Date(),
      instrumentId: transaction.instrumentId,
      type: transaction.type,
      quantity: transaction.quantity,
      unitPrice: transaction.unitPrice,
      fees: transaction.fees,
      occurredAt: transaction.occurredAt,
    });
    Object.assign(transaction, replacement, { note: dto.note?.trim() });
    holding.cashBalance = newCash;
    await transaction.save();
    await this.applyReplayedPositions(holding, affectedIds, states);
    return this.getOverview(userId, boardId);
  }

  async deleteTransaction(
    transactionId: string,
    userId: string,
    boardId: string,
  ) {
    await this.prepareBoard(boardId, userId);
    const transaction = await this.transactionModel.findOne({
      _id: new Types.ObjectId(transactionId),
      boardId: new Types.ObjectId(boardId),
      isVoided: { $ne: true },
    });
    if (!transaction) throw new NotFoundException('Operación no encontrada');
    const holding = await this.requireInvestmentHolding(
      transaction.holdingId.toString(),
      boardId,
    );
    const instrumentId = transaction.instrumentId.toString();
    const state = await this.replayInstrumentTransactions(
      holding._id,
      instrumentId,
      undefined,
      transaction._id.toString(),
    );
    const newCash =
      (await this.ensureInvestmentCashBalance(holding)) -
      this.transactionCashEffect(transaction);
    if (newCash < 0) {
      throw new BadRequestException(
        'No se puede eliminar: el efectivo disponible quedaría en negativo',
      );
    }
    transaction.correctionHistory ??= [];
    transaction.correctionHistory.push({
      action: 'deleted',
      correctedAt: new Date(),
      instrumentId: transaction.instrumentId,
      type: transaction.type,
      quantity: transaction.quantity,
      unitPrice: transaction.unitPrice,
      fees: transaction.fees,
      occurredAt: transaction.occurredAt,
    });
    transaction.isVoided = true;
    holding.cashBalance = newCash;
    await transaction.save();
    await this.applyReplayedPositions(holding, [instrumentId], [state]);
  }

  private transactionCashEffect(transaction: {
    type: InvestmentTransactionType;
    quantity: number;
    unitPrice: number;
    fees?: number;
  }) {
    const gross = transaction.quantity * transaction.unitPrice;
    return transaction.type === InvestmentTransactionType.BUY
      ? -gross - (transaction.fees ?? 0)
      : gross - (transaction.fees ?? 0);
  }

  private async replayInstrumentTransactions(
    holdingId: Types.ObjectId,
    instrumentId: string,
    replacement?: {
      _id: Types.ObjectId;
      instrumentId: Types.ObjectId;
      type: InvestmentTransactionType;
      quantity: number;
      unitPrice: number;
      fees: number;
      occurredAt: Date;
    },
    excludedId?: string,
  ) {
    const transactions = await this.transactionModel
      .find({
        holdingId,
        isVoided: { $ne: true },
        $or: [
          { instrumentId: new Types.ObjectId(instrumentId) },
          ...(replacement?.instrumentId.toString() === instrumentId
            ? [{ _id: replacement._id }]
            : []),
        ],
      })
      .sort({ occurredAt: 1, createdAt: 1 })
      .lean();
    const replay = transactions
      .filter((item) => item._id.toString() !== excludedId)
      .map((item) =>
        replacement && item._id.toString() === replacement._id.toString()
          ? replacement
          : item,
      )
      .filter((item) => item.instrumentId.toString() === instrumentId)
      .sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
    let quantity = 0;
    let cost = 0;
    for (const item of replay) {
      if (item.type === InvestmentTransactionType.BUY) {
        quantity += item.quantity;
        cost += item.quantity * item.unitPrice + (item.fees ?? 0);
      } else {
        if (item.quantity > quantity) {
          throw new BadRequestException(
            'La corrección dejaría una venta sin unidades suficientes en esa fecha',
          );
        }
        const averageCost = quantity ? cost / quantity : 0;
        quantity -= item.quantity;
        cost -= item.quantity * averageCost;
      }
    }
    return { quantity, averageCost: quantity ? cost / quantity : 0 };
  }

  private async applyReplayedPositions(
    holding: HoldingDocument,
    instrumentIds: string[],
    states: Array<{ quantity: number; averageCost: number }>,
  ) {
    for (const [index, instrumentId] of instrumentIds.entries()) {
      let position = await this.positionModel.findOne({
        holdingId: holding._id,
        instrumentId: new Types.ObjectId(instrumentId),
      });
      const state = states[index];
      if (!position && state.quantity > 0) {
        position = new this.positionModel({
          userId: holding.userId,
          boardId: holding.boardId,
          holdingId: holding._id,
          instrumentId: new Types.ObjectId(instrumentId),
          currentPrice: state.averageCost,
        });
      }
      if (!position) continue;
      position.quantity = state.quantity;
      position.averageCost = state.averageCost;
      position.isOpen = state.quantity > 0;
      await position.save();
    }
    await this.recalculateInvestmentHolding(holding);
  }

  private async requireInvestmentHolding(id: string, boardId: string) {
    const holding = await this.requireHolding(id, boardId);
    if (holding.type !== HoldingType.INVESTMENT) {
      throw new BadRequestException(
        'La tenencia no es una cuenta de inversión',
      );
    }
    return holding;
  }

  private async recalculateInvestmentHolding(holding: HoldingDocument) {
    const positions = await this.positionModel
      .find({ holdingId: holding._id, isOpen: true })
      .lean();
    holding.currentBalance =
      (holding.cashBalance ?? 0) +
      positions.reduce(
        (sum, position) => sum + position.quantity * position.currentPrice,
        0,
      );
    if (holding.currentBalance < holding.allocatedBalance) {
      throw new BadRequestException(
        'La valuación queda debajo del dinero asignado',
      );
    }
    await holding.save();
  }

  private async ensureInvestmentCashBalance(holding: HoldingDocument) {
    if (holding.cashBalance !== undefined && holding.cashBalance !== null) {
      return holding.cashBalance;
    }
    const positions = await this.positionModel
      .find({ holdingId: holding._id, isOpen: true })
      .lean();
    const investedValue = positions.reduce(
      (sum, position) => sum + position.quantity * position.currentPrice,
      0,
    );
    holding.cashBalance = Math.max(0, holding.currentBalance - investedValue);
    await holding.save();
    return holding.cashBalance;
  }

  private async prepareBoard(boardId: string, userId: string) {
    await this.participantsService.ensureBoardParticipantAccess(
      boardId,
      userId,
    );
    const boardObjectId = new Types.ObjectId(boardId);
    const board = await this.boardModel.findById(boardObjectId).lean();
    if (!board) throw new NotFoundException('Tablero no encontrado');

    // Compatibility migration for wealth created before it was board-scoped.
    // It is safe to attach only when this is still the creator's active board.
    const creator = await this.userModel
      .findById(board.createdBy)
      .select('activeBoardId')
      .lean();
    if (creator?.activeBoardId?.toString() !== boardId) return;

    const legacyFilter = {
      userId: board.createdBy,
      boardId: { $exists: false },
    };
    await Promise.all([
      this.holdingModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.eventModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.positionModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
      this.transactionModel.updateMany(legacyFilter, {
        $set: { boardId: boardObjectId },
      }),
    ]);
  }

  private async requireHolding(id: string, boardId: string) {
    const holding = await this.holdingModel.findOne({
      _id: new Types.ObjectId(id),
      boardId: new Types.ObjectId(boardId),
    });
    if (!holding) throw new NotFoundException('Tenencia no encontrada');
    return holding;
  }

  private buildTotalsByCurrency(holdings: Array<Record<string, unknown>>) {
    const totals: Record<
      string,
      { balance: number; allocated: number; available: number }
    > = {};
    for (const holding of holdings) {
      const currency = String(holding.currency);
      const balance = Number(holding.currentBalance);
      const allocated = Number(holding.allocatedBalance);
      totals[currency] ??= { balance: 0, allocated: 0, available: 0 };
      totals[currency].balance += balance;
      totals[currency].allocated += allocated;
      totals[currency].available += balance - allocated;
    }
    return totals;
  }
}
