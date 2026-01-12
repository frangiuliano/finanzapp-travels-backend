import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ParticipantRole {
  OWNER = 'owner',
  MEMBER = 'member',
}

@Schema({ timestamps: true })
export class Participant {
  @Prop({ type: Types.ObjectId, ref: 'Trip', required: true })
  tripId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  userId?: Types.ObjectId;

  @Prop({ required: false })
  guestName?: string;

  @Prop({ required: false, lowercase: true, trim: true })
  guestEmail?: string;

  @Prop({
    type: String,
    enum: ParticipantRole,
    default: ParticipantRole.MEMBER,
    required: true,
  })
  role: ParticipantRole;

  @Prop({ type: Types.ObjectId, ref: 'Invitation', required: false })
  invitationId?: Types.ObjectId;
}

export type ParticipantDocument = Participant & Document;

export const ParticipantSchema = SchemaFactory.createForClass(Participant);

ParticipantSchema.pre('save', function () {
  if ((this.userId === null || this.userId === undefined) && this.guestName) {
    this.set('userId', undefined, { strict: false });
    delete this.userId;
  }
});

ParticipantSchema.pre('validate', function () {
  if (!this.userId && !this.guestName) {
    const error = new Error(
      'Debe tener userId o guestName. El participante debe ser un usuario registrado o un invitado.',
    );
    error.name = 'ValidationError';
    throw error;
  }
  if (this.userId && this.guestName) {
    const error = new Error(
      'No puede tener userId y guestName al mismo tiempo. El participante debe ser un usuario registrado O un invitado.',
    );
    error.name = 'ValidationError';
    throw error;
  }
});

ParticipantSchema.index(
  { tripId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $exists: true } }, // Solo indexa documentos donde userId existe
  },
);

ParticipantSchema.index(
  { tripId: 1, guestEmail: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userId: { $exists: false },
      guestEmail: { $exists: true, $ne: null },
    },
  },
);
