import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Budget, BudgetDocument } from './budget.schema';
import {
  Participant,
  ParticipantDocument,
} from '../participants/schemas/participant.schema';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
  ) {}

  async create(
    createBudgetDto: CreateBudgetDto,
    userId: string,
  ): Promise<Budget> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(createBudgetDto.tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este viaje o el viaje no existe',
      );
    }

    const budget = new this.budgetModel({
      ...createBudgetDto,
      tripId: new Types.ObjectId(createBudgetDto.tripId),
      currency: createBudgetDto.currency || DEFAULT_CURRENCY,
      createdBy: new Types.ObjectId(userId),
    });

    return await budget.save();
  }

  async findAllByTrip(tripId: string, userId: string): Promise<Budget[]> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este viaje o el viaje no existe',
      );
    }

    const budgets = await this.budgetModel
      .find({ tripId: new Types.ObjectId(tripId) })
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    return budgets;
  }

  async findOne(id: string, userId: string): Promise<Budget> {
    const budget = await this.budgetModel.findById(id).lean();

    if (!budget) {
      throw new NotFoundException('Presupuesto no encontrado');
    }

    const participant = await this.participantModel.findOne({
      tripId: budget.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este presupuesto o el viaje no existe',
      );
    }

    return budget;
  }

  async update(
    id: string,
    updateBudgetDto: UpdateBudgetDto,
    userId: string,
  ): Promise<Budget> {
    const budget = await this.budgetModel.findById(id);

    if (!budget) {
      throw new NotFoundException('Presupuesto no encontrado');
    }

    const participant = await this.participantModel.findOne({
      tripId: budget.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este presupuesto o el viaje no existe',
      );
    }

    Object.assign(budget, updateBudgetDto);
    budget.updatedAt = new Date();
    return await budget.save();
  }

  async remove(id: string, userId: string): Promise<void> {
    const budget = await this.budgetModel.findById(id);

    if (!budget) {
      throw new NotFoundException('Presupuesto no encontrado');
    }

    const participant = await this.participantModel.findOne({
      tripId: budget.tripId,
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new ForbiddenException(
        'No tienes acceso a este presupuesto o el viaje no existe',
      );
    }

    await this.budgetModel.findByIdAndDelete(id);
  }

  async findAll(tripId: string, userId: string): Promise<Budget[]> {
    return this.findAllByTrip(tripId, userId);
  }
}
