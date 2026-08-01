import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class BoardMonthBudget {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true })
  yearMonth: string;

  @Prop({ required: true, min: 0 })
  limit: number;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export type BoardMonthBudgetDocument = BoardMonthBudget & Document;

export const BoardMonthBudgetSchema =
  SchemaFactory.createForClass(BoardMonthBudget);

BoardMonthBudgetSchema.index(
  { tripId: 1, categoryId: 1, yearMonth: 1 },
  { unique: true },
);
BoardMonthBudgetSchema.index({ tripId: 1, yearMonth: 1 });
