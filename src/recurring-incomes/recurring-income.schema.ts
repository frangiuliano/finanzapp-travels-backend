import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class RecurringIncome {
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

  @Prop({ type: [Number], required: true })
  daysOfMonth: number[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type RecurringIncomeDocument = RecurringIncome & Document;

export const RecurringIncomeSchema =
  SchemaFactory.createForClass(RecurringIncome);

RecurringIncomeSchema.index({ tripId: 1, isActive: 1 });
