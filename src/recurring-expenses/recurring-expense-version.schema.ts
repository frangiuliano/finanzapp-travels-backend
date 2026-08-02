import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RecurringExpenseVersion {
  @Prop({ type: Types.ObjectId, ref: 'RecurringExpense', required: true })
  recurringExpenseId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  /** YYYY-MM — amount applies from this month onward */
  @Prop({ required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  effectiveFrom: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type RecurringExpenseVersionDocument = RecurringExpenseVersion &
  Document;

export const RecurringExpenseVersionSchema = SchemaFactory.createForClass(
  RecurringExpenseVersion,
);

RecurringExpenseVersionSchema.index(
  { recurringExpenseId: 1, effectiveFrom: 1 },
  { unique: true },
);
