import { Types } from 'mongoose';
import { UserDocument } from '../../users/user.schema';
import { PopulatedParticipant } from '../types/populated.types';

export function getUserName(user: UserDocument | null): string {
  return user ? `${user.firstName} ${user.lastName}`.trim() : 'Usuario';
}

export function getParticipantName(participant: PopulatedParticipant): string {
  return (
    participant.guestName ||
    (participant.userId &&
    typeof participant.userId === 'object' &&
    'firstName' in participant.userId
      ? `${participant.userId.firstName} ${participant.userId.lastName}`.trim()
      : 'Participante')
  );
}

export function getCardId(card: unknown): string {
  const cardAny = card as { _id?: Types.ObjectId | string; id?: string };
  if (cardAny._id) {
    return typeof cardAny._id === 'string'
      ? cardAny._id
      : cardAny._id.toString();
  }
  if (cardAny.id) {
    return cardAny.id;
  }
  return '';
}
