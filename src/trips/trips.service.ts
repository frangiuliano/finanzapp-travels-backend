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
  }

  async create(createBoardDto: CreateBoardDto, userId: string): Promise<Board> {
    const board = new this.boardModel({
      ...createBoardDto,
      baseCurrency: createBoardDto.baseCurrency || DEFAULT_CURRENCY,
      type: createBoardDto.type ?? BoardType.TRAVEL,
      createdBy: new Types.ObjectId(userId),
    });

    const savedBoard = await board.save();

    await this.participantModel.create({
      tripId: savedBoard._id,
      userId: new Types.ObjectId(userId),
      role: ParticipantRole.OWNER,
    });

    await this.categoriesService.seedDefaults(savedBoard._id.toString());

    return savedBoard;
  }

  async findAll(
    userId: string,
  ): Promise<(Board & { userRole: ParticipantRole })[]> {
    const participants = await this.participantModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('tripId role')
      .lean();

    const boardIds = participants.map((p) => p.tripId);

    if (boardIds.length === 0) {
      return [];
    }

    const boards = await this.boardModel
      .find({ _id: { $in: boardIds } })
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
      };
    });
  }

  async findOne(id: string, userId: string): Promise<Board> {
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

    await this.budgetModel.deleteMany({ tripId: boardId });
    await this.categoriesService.deleteByBoard(id);
    await this.paymentMethodsService.deleteByBoard(id);
    await this.participantModel.deleteMany({ tripId: boardId });
    await this.invitationModel.deleteMany({ tripId: boardId });
    await this.boardModel.findByIdAndDelete(id);
  }
}

/** @deprecated Use BoardsService */
export { BoardsService as TripsService };
