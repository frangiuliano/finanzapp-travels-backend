import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RecurringIncomeVersion {
  @Prop({ type: Types.ObjectId, ref: 'RecurringIncome', required: true })
  recurringIncomeId: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  /** YYYY-MM — amount applies from this month onward */
  @Prop({ required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  effectiveFrom: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type RecurringIncomeVersionDocument = RecurringIncomeVersion & Document;

export const RecurringIncomeVersionSchema = SchemaFactory.createForClass(
  RecurringIncomeVersion,
);

RecurringIncomeVersionSchema.index(
  { recurringIncomeId: 1, effectiveFrom: 1 },
  { unique: true },
);
