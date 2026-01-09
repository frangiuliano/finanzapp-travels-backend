import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  Participant,
  ParticipantDocument,
  ParticipantRole,
} from './schemas/participant.schema';
import {
  Invitation,
  InvitationDocument,
  InvitationStatus,
} from './schemas/invitation.schema';
import { Trip, TripDocument } from '../trips/trip.schema';
import { User, UserDocument } from '../users/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { InviteParticipantDto } from './dto';
import { InvitationInfo, AcceptInvitationResult } from './interfaces';

export { InvitationInfo, AcceptInvitationResult };

@Injectable()
export class ParticipantsService {
  private readonly logger = new Logger(ParticipantsService.name);

  constructor(
    @InjectModel(Participant.name)
    private participantModel: Model<ParticipantDocument>,
    @InjectModel(Invitation.name)
    private invitationModel: Model<InvitationDocument>,
    @InjectModel(Trip.name)
    private tripModel: Model<TripDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private notificationsService: NotificationsService,
  ) {}

  async inviteParticipant(
    inviteDto: InviteParticipantDto,
    invitedByUserId: string,
  ): Promise<Invitation> {
    const { tripId, email } = inviteDto;
    const normalizedEmail = email.toLowerCase().trim();

    const trip = await this.tripModel.findById(tripId);
    if (!trip) {
      throw new NotFoundException('Viaje no encontrado');
    }

    const inviterParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(invitedByUserId),
      role: ParticipantRole.OWNER,
    });

    if (!inviterParticipant) {
      throw new ForbiddenException(
        'Solo el propietario del viaje puede invitar participantes',
      );
    }

    const existingUser = await this.userModel.findOne({
      email: normalizedEmail,
    });
    if (existingUser) {
      const existingParticipant = await this.participantModel.findOne({
        tripId: new Types.ObjectId(tripId),
        userId: existingUser._id,
      });

      if (existingParticipant) {
        throw new BadRequestException(
          'Este usuario ya es participante del viaje',
        );
      }
    }

    const existingInvitation = await this.invitationModel.findOne({
      tripId: new Types.ObjectId(tripId),
      email: normalizedEmail,
      status: InvitationStatus.PENDING,
    });

    if (existingInvitation) {
      throw new BadRequestException(
        'Ya existe una invitación pendiente para este email',
      );
    }

    const token = randomBytes(32).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.invitationModel.create({
      tripId: new Types.ObjectId(tripId),
      email: normalizedEmail,
      invitedBy: new Types.ObjectId(invitedByUserId),
      token,
      status: InvitationStatus.PENDING,
      expiresAt,
    });

    const inviter = await this.userModel.findById(invitedByUserId);

    await this.notificationsService.sendTripInvitationEmail(
      normalizedEmail,
      `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() ||
        'Un usuario',
      trip.name,
      token,
    );

    this.logger.log(
      `Invitación enviada a ${normalizedEmail} para el viaje ${trip.name}`,
    );

    return invitation;
  }

  async getInvitationInfo(token: string): Promise<InvitationInfo> {
    const invitation = await this.invitationModel.findOne({ token });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Esta invitación ya fue ${invitation.status === InvitationStatus.ACCEPTED ? 'aceptada' : invitation.status === InvitationStatus.EXPIRED ? 'expirada' : 'cancelada'}`,
      );
    }

    if (new Date() > invitation.expiresAt) {
      await this.invitationModel.updateOne(
        { _id: invitation._id },
        { status: InvitationStatus.EXPIRED },
      );
      throw new BadRequestException('Esta invitación ha expirado');
    }

    const trip = await this.tripModel
      .findById(invitation.tripId)
      .select('name description')
      .lean();

    const inviter = await this.userModel
      .findById(invitation.invitedBy)
      .select('firstName lastName')
      .lean();

    const userExists = await this.userModel.exists({ email: invitation.email });

    return {
      invitation,
      trip: trip as { _id: Types.ObjectId; name: string; description?: string },
      inviter: inviter as { firstName: string; lastName: string },
      userExists: !!userExists,
      userEmail: invitation.email,
    };
  }

  async acceptInvitation(
    token: string,
    userId?: string,
  ): Promise<AcceptInvitationResult> {
    const invitation = await this.invitationModel.findOne({ token });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Esta invitación ya fue ${invitation.status === InvitationStatus.ACCEPTED ? 'aceptada' : invitation.status === InvitationStatus.EXPIRED ? 'expirada' : 'cancelada'}`,
      );
    }

    if (new Date() > invitation.expiresAt) {
      await this.invitationModel.updateOne(
        { _id: invitation._id },
        { status: InvitationStatus.EXPIRED },
      );
      throw new BadRequestException('Esta invitación ha expirado');
    }

    const user = await this.userModel.findOne({ email: invitation.email });

    if (!user) {
      return {
        success: false,
        message: 'Debes crear una cuenta para aceptar esta invitación',
        requiresRegistration: true,
        email: invitation.email,
      };
    }

    if (userId && user._id.toString() !== userId) {
      throw new ForbiddenException(
        'Esta invitación fue enviada a otro email. Inicia sesión con el email correcto.',
      );
    }

    const existingParticipant = await this.participantModel.findOne({
      tripId: invitation.tripId,
      userId: user._id,
    });

    if (existingParticipant) {
      await this.invitationModel.updateOne(
        { _id: invitation._id },
        { status: InvitationStatus.ACCEPTED },
      );

      return {
        success: true,
        message: 'Ya eres participante de este viaje',
        participant: existingParticipant,
      };
    }

    const participant = await this.participantModel.create({
      tripId: invitation.tripId,
      userId: user._id,
      role: ParticipantRole.MEMBER,
    });

    await this.invitationModel.updateOne(
      { _id: invitation._id },
      { status: InvitationStatus.ACCEPTED },
    );

    this.logger.log(
      `Invitación aceptada: ${user.email} se unió al viaje ${invitation.tripId.toString()}`,
    );

    return {
      success: true,
      message: '¡Te has unido al viaje exitosamente!',
      participant,
    };
  }

  async cancelInvitation(
    invitationId: string,
    userId: string,
  ): Promise<Invitation> {
    const invitation = await this.invitationModel.findById(invitationId);

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    const ownerParticipant = await this.participantModel.findOne({
      tripId: invitation.tripId,
      userId: new Types.ObjectId(userId),
      role: ParticipantRole.OWNER,
    });

    if (!ownerParticipant) {
      throw new ForbiddenException(
        'Solo el propietario del viaje puede cancelar invitaciones',
      );
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        'Solo se pueden cancelar invitaciones pendientes',
      );
    }

    invitation.status = InvitationStatus.CANCELLED;
    await invitation.save();

    return invitation;
  }

  async findByTrip(tripId: string, userId: string): Promise<Participant[]> {
    const userParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
    });

    if (!userParticipant) {
      throw new ForbiddenException('No tienes acceso a este viaje');
    }

    const participants = await this.participantModel
      .find({ tripId: new Types.ObjectId(tripId) })
      .populate('userId', 'firstName lastName email')
      .lean();

    return participants;
  }

  async getPendingInvitations(
    tripId: string,
    userId: string,
  ): Promise<Invitation[]> {
    const ownerParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(userId),
      role: ParticipantRole.OWNER,
    });

    if (!ownerParticipant) {
      throw new ForbiddenException(
        'Solo el propietario puede ver las invitaciones pendientes',
      );
    }

    return this.invitationModel
      .find({
        tripId: new Types.ObjectId(tripId),
        status: InvitationStatus.PENDING,
      })
      .lean();
  }

  async removeParticipant(
    tripId: string,
    participantUserId: string,
    requestingUserId: string,
  ): Promise<void> {
    const ownerParticipant = await this.participantModel.findOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(requestingUserId),
      role: ParticipantRole.OWNER,
    });

    if (!ownerParticipant) {
      throw new ForbiddenException(
        'Solo el propietario puede eliminar participantes',
      );
    }

    if (participantUserId === requestingUserId) {
      throw new BadRequestException(
        'No puedes eliminarte a ti mismo del viaje',
      );
    }

    const result = await this.participantModel.deleteOne({
      tripId: new Types.ObjectId(tripId),
      userId: new Types.ObjectId(participantUserId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Participante no encontrado');
    }
  }
}
