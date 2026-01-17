import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ConversationState {
  IDLE = 'idle',
  PARSING_EXPENSE = 'parsing_expense',
  ASKING_TRIP = 'asking_trip',
  ASKING_BUCKET = 'asking_bucket',
  ASKING_PAYER = 'asking_payer',
  ASKING_MERCHANT = 'asking_merchant',
  ASKING_PAYMENT_METHOD = 'asking_payment_method',
  ASKING_CARD = 'asking_card',
  ASKING_SPLIT = 'asking_split',
  CONFIRMING = 'confirming',
}

@Schema({ timestamps: true })
export class BotUpdate {
  @Prop({ type: Number, required: true, unique: true, index: true })
  telegramUserId: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ConversationState,
    default: ConversationState.IDLE,
  })
  state: ConversationState;

  @Prop({ type: Types.ObjectId, ref: 'Trip' })
  currentTripId?: Types.ObjectId;

  @Prop({ type: Object })
  pendingExpense?: {
    amount?: number;
    currency?: string;
    description?: string;
    merchantName?: string;
    budgetId?: string;
    paidByParticipantId?: string;
    paymentMethod?: string;
    cardId?: string;
    isDivisible?: boolean;
    splitType?: string;
    splits?: Array<{ participantId: string; amount?: number }>;
  };
}

export type BotUpdateDocument = BotUpdate & Document;
export const BotUpdateSchema = SchemaFactory.createForClass(BotUpdate);
