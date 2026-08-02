import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'billingperiods' })
export class BillingPeriod {
  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: true })
  paymentMethodId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  cycleLabel: string;

  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  periodFrom: string;

  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  periodTo: string;

  @Prop({ type: Date, required: true })
  confirmedAt: Date;
}

export type BillingPeriodDocument = BillingPeriod & Document;

export const BillingPeriodSchema = SchemaFactory.createForClass(BillingPeriod);

BillingPeriodSchema.index(
  { paymentMethodId: 1, cycleLabel: 1 },
  { unique: true },
);
