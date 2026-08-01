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

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type RecurringExpenseDocument = RecurringExpense & Document;

export const RecurringExpenseSchema =
  SchemaFactory.createForClass(RecurringExpense);

RecurringExpenseSchema.index({ tripId: 1, isActive: 1 });
