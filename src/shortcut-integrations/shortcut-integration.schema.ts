import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ShortcutCaptureMode {
  GUIDED = 'guided',
  ADAPTIVE = 'adaptive',
}

@Schema({ timestamps: true, collection: 'shortcutintegrationtokens' })
export class ShortcutIntegrationToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 80, trim: true })
  name: string;

  @Prop({ required: true, unique: true, select: false })
  tokenHash: string;

  @Prop({ required: true, maxlength: 16 })
  tokenPrefix: string;

  @Prop({
    type: String,
    enum: ShortcutCaptureMode,
    default: ShortcutCaptureMode.GUIDED,
    required: true,
  })
  mode: ShortcutCaptureMode;

  @Prop({ type: Date })
  lastUsedAt?: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export type ShortcutIntegrationTokenDocument = ShortcutIntegrationToken &
  Document;

export const ShortcutIntegrationTokenSchema = SchemaFactory.createForClass(
  ShortcutIntegrationToken,
);

ShortcutIntegrationTokenSchema.index({ userId: 1, revokedAt: 1 });
