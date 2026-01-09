import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Trip, TripDocument } from './trip.schema';
import {
  Participant,
  ParticipantDocument,
  ParticipantRole,
} from '../participants/schemas/participant.schema';
import { CreateTripDto } from './dto/create-trip.dto';

@Injectable()
export class TripsService {
  constructor(
    @InjectModel(Trip.name) private tripModel: Model<TripDocument>,
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
  ) {}

  async create(createTripDto: CreateTripDto, userId: string): Promise<Trip> {
    const trip = new this.tripModel({
      ...createTripDto,
      baseCurrency: createTripDto.baseCurrency || 'USD',
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

  async findAll(userId: string): Promise<Trip[]> {
    const participants = await this.participantModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('tripId')
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

    return trips;
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
}
