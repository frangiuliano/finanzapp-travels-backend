import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'paymentmethodboardexclusions' })
export class PaymentMethodBoardExclusion {
  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: true })
  paymentMethodId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;
}

export type PaymentMethodBoardExclusionDocument = PaymentMethodBoardExclusion &
  Document;

export const PaymentMethodBoardExclusionSchema = SchemaFactory.createForClass(
  PaymentMethodBoardExclusion,
);

PaymentMethodBoardExclusionSchema.index(
  { paymentMethodId: 1, tripId: 1 },
  { unique: true },
);
PaymentMethodBoardExclusionSchema.index({ tripId: 1, paymentMethodId: 1 });
