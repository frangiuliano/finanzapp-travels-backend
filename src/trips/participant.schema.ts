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

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ParticipantRole,
    default: ParticipantRole.MEMBER,
    required: true,
  })
  role: ParticipantRole;
}

export type ParticipantDocument = Participant & Document;

export const ParticipantSchema = SchemaFactory.createForClass(Participant);

// Índice único para evitar duplicados de usuario en el mismo viaje
ParticipantSchema.index({ tripId: 1, userId: 1 }, { unique: true });
