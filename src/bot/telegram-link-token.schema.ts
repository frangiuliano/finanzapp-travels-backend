import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class TelegramLinkToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ default: Date.now, expires: 3600 })
  expiresAt: Date;
}

export type TelegramLinkTokenDocument = TelegramLinkToken & Document;
export const TelegramLinkTokenSchema =
  SchemaFactory.createForClass(TelegramLinkToken);
TelegramLinkTokenSchema.index({ token: 1 });
