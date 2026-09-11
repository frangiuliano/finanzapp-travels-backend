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

export enum ExpenseFxPolicy {
  SPOT = 'spot',
  CREDIT_CYCLE = 'credit_cycle',
}

export enum ExpenseFxPurpose {
  REFERENTIAL = 'referential',
  SETTLED = 'settled',
}

export interface ExpenseSplit {
  participantId: Types.ObjectId;
  amount: number;
  percentage?: number;
}

@Schema({ timestamps: true })
export class Expense {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Budget', required: false })
  budgetId?: Types.ObjectId;

  // Refunds are stored as a negative amount so every sum across the app
  // (totals, budgets, forecasts) nets them out automatically.
  @Prop({
    required: true,
    validate: {
      validator: (value: number) => value !== 0,
      message: 'El monto no puede ser 0',
    },
  })
  amount: number;

  /** True when this expense is a refund/reembolso: reduces spend instead of adding to it. */
  @Prop({ type: Boolean, default: false, required: false })
  isRefund?: boolean;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  /** 1 unit of expense.currency = fxRateToBoardCurrency in board.baseCurrency */
  @Prop({ required: false, min: 0 })
  fxRateToBoardCurrency?: number;

  @Prop({ type: Date, required: false })
  fxCapturedAt?: Date;

  @Prop({
    type: String,
    enum: ExpenseFxPolicy,
    required: false,
  })
  fxPolicy?: ExpenseFxPolicy;

  @Prop({
    type: String,
    enum: ExpenseFxPurpose,
    required: false,
  })
  fxPurpose?: ExpenseFxPurpose;

  /** Month (YYYY-MM) this expense counts toward — an explicit user choice, not derived from the expense date. */
  @Prop({ required: false, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  paymentYearMonth?: string;

  @Prop({ required: false, minlength: 3, maxlength: 500 })
  description?: string;

  // Mandatory only for manually created expenses (enforced in CreateExpenseDto);
  // recurring/installment materialization does not carry a merchant concept.
  @Prop({ required: false, maxlength: 100 })
  merchantName?: string;

  @Prop({ required: false, type: [String], default: [] })
  tags?: string[];

  @Prop({ required: false, maxlength: 50 })
  category?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: false })
  categoryId?: Types.ObjectId;

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

  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: false })
  cardId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: false })
  paymentMethodId?: Types.ObjectId;

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

  @Prop({ type: Types.ObjectId, ref: 'RecurringExpense', required: false })
  recurringExpenseId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstallmentPlan', required: false })
  installmentPlanId?: Types.ObjectId;

  @Prop({ type: Number, required: false, min: 1 })
  installmentNumber?: number;

  @Prop({ required: false })
  occurrenceKey?: string;

  @Prop({ type: Date, required: false })
  skippedAt?: Date;

  /**
   * Fields manually edited on this specific installment/recurring occurrence
   * that diverge from its plan's defaults (e.g. ['amount', 'description']).
   * Plan-level bulk edits must not silently overwrite these without explicit
   * confirmation.
   */
  @Prop({ type: [String], required: false, default: [] })
  overriddenFields?: string[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  /** Client-generated UUID for offline sync idempotency (unique per user). */
  @Prop({ type: String, required: false, maxlength: 36 })
  clientRequestId?: string;

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
ExpenseSchema.index({ tripId: 1, expenseDate: -1 });
// Every month-scoped read (Movimientos, forecast, monthly summaries) filters
// by tripId + paymentYearMonth; without this compound index that filter
// degrades to a collection scan as the number of expenses grows.
ExpenseSchema.index({ tripId: 1, paymentYearMonth: 1 });
ExpenseSchema.index(
  { budgetId: 1 },
  { partialFilterExpression: { budgetId: { $exists: true } } },
);
ExpenseSchema.index({ paidByParticipantId: 1 });
ExpenseSchema.index({ status: 1 });
ExpenseSchema.index({ expenseDate: -1 });
ExpenseSchema.index({ cardId: 1 });
ExpenseSchema.index({ categoryId: 1 });
ExpenseSchema.index({ paymentMethodId: 1 });
ExpenseSchema.index({ installmentPlanId: 1, installmentNumber: 1 });
ExpenseSchema.index(
  { createdBy: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientRequestId: { $exists: true, $type: 'string' },
    },
  },
);
ExpenseSchema.index({ occurrenceKey: 1 }, { unique: true, sparse: true });
