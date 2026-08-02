import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum InAppNotificationType {
  BILLING_PERIOD_CONFIRMATION = 'billing_period_confirmation',
}

@Schema({ timestamps: true, collection: 'inappnotifications' })
export class InAppNotification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: InAppNotificationType,
    required: true,
  })
  type: InAppNotificationType;

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
InAppNotificationSchema.index(
  { userId: 1, type: 1, 'payload.paymentMethodId': 1, 'payload.cycleLabel': 1 },
  { unique: true, sparse: true },
);
