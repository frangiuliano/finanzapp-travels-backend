import { Types } from 'mongoose';

function idString(value: unknown): string {
  if (value instanceof Types.ObjectId) return value.toString();
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '_id' in value) {
    return idString((value as { _id: unknown })._id);
  }
  return '';
}

export function getPersonalExpenseAmount(
  expense: {
    amount: number;
    isDivisible?: boolean;
    paidByParticipantId?: unknown;
    splits?: Array<{ participantId: unknown; amount: number }>;
  },
  participantId: Types.ObjectId | string,
): number {
  const targetId = idString(participantId);
  if (expense.isDivisible) {
    return (
      expense.splits?.find(
        (split) => idString(split.participantId) === targetId,
      )?.amount ?? 0
    );
  }
  return idString(expense.paidByParticipantId) === targetId
    ? expense.amount
    : 0;
}
