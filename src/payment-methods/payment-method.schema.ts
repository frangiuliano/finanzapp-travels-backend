import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PaymentMethodOwnerType {
  USER = 'user',
  BOARD = 'board',
}

export enum PaymentMethodKind {
  CASH = 'cash',
  DEBIT = 'debit',
  CREDIT = 'credit',
}

@Schema({ timestamps: true, collection: 'paymentmethods' })
export class PaymentMethod {
  @Prop({
    type: String,
    enum: PaymentMethodOwnerType,
    required: true,
  })
  ownerType: PaymentMethodOwnerType;

  @Prop({
    type: String,
    enum: PaymentMethodKind,
    required: true,
  })
  kind: PaymentMethodKind;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Board' })
  tripId?: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  name: string;

  @Prop({ minlength: 4, maxlength: 4 })
  lastFourDigits?: string;

  @Prop({ maxlength: 50 })
  brand?: string;

  @Prop({ min: 1, max: 28 })
  closingDay?: number;

  @Prop({ min: 1, max: 28 })
  dueDay?: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId })
  migratedFromCardId?: Types.ObjectId;
}

export type PaymentMethodDocument = PaymentMethod & Document;

export const PaymentMethodSchema = SchemaFactory.createForClass(PaymentMethod);

PaymentMethodSchema.index({ ownerType: 1, userId: 1, isActive: 1 });
PaymentMethodSchema.index({ ownerType: 1, tripId: 1, isActive: 1 });
PaymentMethodSchema.index({ migratedFromCardId: 1 });
