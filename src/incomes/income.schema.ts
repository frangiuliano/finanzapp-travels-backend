import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Income {
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

  @Prop({ type: Date, default: Date.now })
  incomeDate: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export type IncomeDocument = Income & Document;

export const IncomeSchema = SchemaFactory.createForClass(Income);

IncomeSchema.index({ tripId: 1, incomeDate: -1 });
IncomeSchema.index({ tripId: 1, createdAt: -1 });
