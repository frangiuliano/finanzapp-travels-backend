import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RecurringExpense {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ required: true, minlength: 1, maxlength: 200 })
  label: string;

  @Prop({ required: false, maxlength: 500 })
  description?: string;

  @Prop({ required: true, min: 1, max: 31 })
  dayOfMonth: number;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: false })
  categoryId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: false })
  paymentMethodId?: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;

  /** When set, no occurrences are generated from this month onward */
  @Prop({ required: false, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  inactiveFromYearMonth?: string;

  /** 'percent' = grows by escalationValue% every interval (compounded). 'fixed' = adds escalationValue every interval. */
  @Prop({ type: String, enum: ['percent', 'fixed'], required: false })
  escalationType?: 'percent' | 'fixed';

  /** Magnitude of the increase: a percentage (0-1000) when escalationType is 'percent', or a currency amount when 'fixed'. */
  @Prop({ required: false, min: 0.01 })
  escalationValue?: number;

  /** How often the increase is applied, in months (e.g. 3 = every 3 months). */
  @Prop({ required: false, min: 1, max: 60 })
  escalationFrequencyMonths?: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type RecurringExpenseDocument = RecurringExpense & Document;

export const RecurringExpenseSchema =
  SchemaFactory.createForClass(RecurringExpense);

RecurringExpenseSchema.index({ tripId: 1, isActive: 1 });
