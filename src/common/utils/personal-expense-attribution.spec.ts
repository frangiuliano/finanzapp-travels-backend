import { Types } from 'mongoose';
import { getPersonalExpenseAmount } from './personal-expense-attribution';

describe('getPersonalExpenseAmount', () => {
  const me = new Types.ObjectId();
  const other = new Types.ObjectId();

  it('uses the current participant split on divisible travel expenses', () => {
    expect(
      getPersonalExpenseAmount(
        {
          amount: 100,
          isDivisible: true,
          paidByParticipantId: other,
          splits: [
            { participantId: me, amount: 40 },
            { participantId: other, amount: 60 },
          ],
        },
        me,
      ),
    ).toBe(40);
  });

  it('uses the full amount only for the payer on non-divisible expenses', () => {
    const expense = {
      amount: 100,
      isDivisible: false,
      paidByParticipantId: me,
    };
    expect(getPersonalExpenseAmount(expense, me)).toBe(100);
    expect(getPersonalExpenseAmount(expense, other)).toBe(0);
  });

  it('returns zero when the participant is not part of the split', () => {
    expect(
      getPersonalExpenseAmount(
        {
          amount: 100,
          isDivisible: true,
          paidByParticipantId: other,
          splits: [{ participantId: other, amount: 100 }],
        },
        me,
      ),
    ).toBe(0);
  });
});
