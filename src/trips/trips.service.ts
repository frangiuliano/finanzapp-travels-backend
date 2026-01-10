import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Trip, TripDocument } from './trip.schema';
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
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { DEFAULT_CURRENCY } from '../common/constants/currencies';

@Injectable()
export class TripsService {
  constructor(
    @InjectModel(Trip.name) private tripModel: Model<TripDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
  ) {}

  async create(createTripDto: CreateTripDto, userId: string): Promise<Trip> {
    const trip = new this.tripModel({
      ...createTripDto,
      baseCurrency: createTripDto.baseCurrency || DEFAULT_CURRENCY,
      createdBy: new Types.ObjectId(userId),
    });

    const savedTrip = await trip.save();

    await this.participantModel.create({
      tripId: savedTrip._id,
      userId: new Types.ObjectId(userId),
      role: ParticipantRole.OWNER,
    });

    return savedTrip;
  }

  async findAll(
    userId: string,
  ): Promise<(Trip & { userRole: ParticipantRole })[]> {
    const participants = await this.participantModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('tripId role')
      .lean();

    const tripIds = participants.map((p) => p.tripId);

    if (tripIds.length === 0) {
      return [];
    }

    const trips = await this.tripModel
      .find({ _id: { $in: tripIds } })
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    const tripsWithRole = trips.map((trip) => {
      const participant = participants.find(
        (p) => p.tripId.toString() === trip._id.toString(),
      );
      return {
        ...trip,
        userRole: participant?.role || ParticipantRole.MEMBER,
      };
    });

    return tripsWithRole;
  }

  async findOne(id: string, userId: string): Promise<Trip> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Viaje no encontrado o no tienes acceso');
    }

    const trip = await this.tripModel
      .findById(id)
      .populate('createdBy', 'firstName lastName email')
      .lean();

    if (!trip) {
      throw new NotFoundException('Viaje no encontrado');
    }

    return trip;
  }

  async update(
    id: string,
    updateTripDto: UpdateTripDto,
    userId: string,
  ): Promise<Trip> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Viaje no encontrado o no tienes acceso');
    }

    if (participant.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException(
        'Solo el propietario del viaje puede actualizarlo',
      );
    }

    const trip = await this.tripModel.findById(id);

    if (!trip) {
      throw new NotFoundException('Viaje no encontrado');
    }

    Object.assign(trip, updateTripDto);
    const updatedTrip = await trip.save();

    return updatedTrip.populate('createdBy', 'firstName lastName email');
  }

  async remove(id: string, userId: string): Promise<void> {
    const participant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });

    if (!participant) {
      throw new NotFoundException('Viaje no encontrado o no tienes acceso');
    }

    if (participant.role !== ParticipantRole.OWNER) {
      throw new ForbiddenException(
        'Solo el propietario del viaje puede eliminarlo',
      );
    }

    const trip = await this.tripModel.findById(id);

    if (!trip) {
      throw new NotFoundException('Viaje no encontrado');
    }

    const tripId = new Types.ObjectId(id);

    await this.budgetModel.deleteMany({ tripId });

    await this.participantModel.deleteMany({ tripId });

    await this.invitationModel.deleteMany({ tripId });

    await this.tripModel.findByIdAndDelete(id);
  }
}
