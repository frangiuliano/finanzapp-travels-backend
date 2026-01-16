import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ExpenseStatus {
  PAID = 'paid',
  PENDING = 'pending',
}

export enum SplitType {
  EQUAL = 'equal',
  MANUAL = 'manual',
}

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
}

export interface ExpenseSplit {
  participantId: Types.ObjectId;
  amount: number;
  percentage?: number;
}

@Schema({ timestamps: true })
export class Expense {
  @Prop({ type: Types.ObjectId, ref: 'Trip', required: true })
  tripId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Budget', required: false })
  budgetId?: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ required: true, minlength: 3, maxlength: 500 })
  description: string;

  @Prop({ required: false, maxlength: 100 })
  merchantName?: string;

  @Prop({ required: false, type: [String], default: [] })
  tags?: string[];

  @Prop({ required: false, maxlength: 50 })
  category?: string;

  @Prop({ type: Types.ObjectId, ref: 'Participant', required: true })
  paidByParticipantId: Types.ObjectId;

  @Prop({
    type: String,
    enum: ExpenseStatus,
    default: ExpenseStatus.PAID,
    required: true,
  })
  status: ExpenseStatus;

  @Prop({
    type: String,
    enum: PaymentMethod,
    default: PaymentMethod.CASH,
    required: true,
  })
  paymentMethod: PaymentMethod;

  @Prop({ type: Types.ObjectId, ref: 'Card', required: false })
  cardId?: Types.ObjectId;

  @Prop({ type: Boolean, default: false, required: true })
  isDivisible: boolean;

  @Prop({
    type: String,
    enum: SplitType,
    required: false,
  })
  splitType?: SplitType;

  @Prop({
    type: [
      {
        participantId: {
          type: Types.ObjectId,
          ref: 'Participant',
          required: true,
        },
        amount: { type: Number, required: true, min: 0 },
        percentage: { type: Number, required: false, min: 0, max: 100 },
      },
    ],
    required: false,
    validate: {
      validator: function (this: Expense, splits?: ExpenseSplit[]) {
        // Si no es divisible, no debe tener splits
        if (!this.isDivisible) {
          return !splits || splits.length === 0;
        }
        // Si es divisible, debe tener splits válidos
        if (!Array.isArray(splits) || splits.length === 0) {
          return false;
        }
        const totalSplit = splits.reduce((sum, split) => sum + split.amount, 0);
        return Math.abs(totalSplit - this.amount) < 0.01;
      },
      message:
        'La suma de las divisiones debe ser igual al monto total del gasto. Si el gasto no es divisible, no debe tener divisiones.',
    },
  })
  splits?: ExpenseSplit[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Date, default: Date.now })
  expenseDate: Date;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export type ExpenseDocument = Expense & Document;

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

ExpenseSchema.index({ tripId: 1, createdAt: -1 });
ExpenseSchema.index(
  { budgetId: 1 },
  { partialFilterExpression: { budgetId: { $exists: true } } },
);
ExpenseSchema.index({ paidByParticipantId: 1 });
ExpenseSchema.index({ status: 1 });
ExpenseSchema.index({ expenseDate: -1 });
ExpenseSchema.index({ cardId: 1 });
