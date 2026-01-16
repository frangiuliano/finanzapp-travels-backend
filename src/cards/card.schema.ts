import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CardType {
  VISA = 'visa',
  MASTERCARD = 'mastercard',
  AMEX = 'amex',
  OTHER = 'other',
}

@Schema({ timestamps: true })
export class Card {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Trip', required: false })
  tripId?: Types.ObjectId;

  @Prop({ required: true, maxlength: 100 })
  name: string;

  @Prop({ required: true, minlength: 4, maxlength: 4 })
  lastFourDigits: string;

  @Prop({
    type: String,
    enum: CardType,
    default: CardType.OTHER,
    required: true,
  })
  type: CardType;

  @Prop({ default: true })
  isActive: boolean;
}

export type CardDocument = Card & Document;

export const CardSchema = SchemaFactory.createForClass(Card);

CardSchema.index({ userId: 1, tripId: 1 });
CardSchema.index({ tripId: 1 });
