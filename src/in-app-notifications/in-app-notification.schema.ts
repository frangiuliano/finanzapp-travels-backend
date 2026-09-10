import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'inappnotifications' })
export class InAppNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  type: string;

  @Prop({ required: true, maxlength: 200, trim: true })
  title: string;

  @Prop({ required: true, maxlength: 1000, trim: true })
  body: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop({ maxlength: 500, trim: true })
  actionPath?: string;

  @Prop({ type: Date, default: null })
  readAt?: Date | null;
}

export type InAppNotificationDocument = InAppNotification & Document;

export const InAppNotificationSchema =
  SchemaFactory.createForClass(InAppNotification);

InAppNotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
