import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
// Note: default value matches DEFAULT_CURRENCY from common/constants/currencies.ts
// Cannot use constant here as it's a runtime default in Mongoose schema

@Schema({ timestamps: true })
export class Trip {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, default: 'USD' })
  baseCurrency: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export type TripDocument = Trip & Document;

export const TripSchema = SchemaFactory.createForClass(Trip);
