import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
// Note: default value matches DEFAULT_CURRENCY from common/constants/currencies.ts
// Cannot use constant here as it's a runtime default in Mongoose schema

@Schema({ timestamps: true })
export class Budget {
  @Prop({ type: Types.ObjectId, ref: 'Trip', required: true })
  tripId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ type: Number, default: 0, min: 0 })
  spent: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export type BudgetDocument = Budget & Document;

export const BudgetSchema = SchemaFactory.createForClass(Budget);

BudgetSchema.index({ tripId: 1 });
