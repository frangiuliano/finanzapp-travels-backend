import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { StatementLineSource } from './parsing/generic-statement-parser';

@Schema({ _id: false })
export class StatementImportLine {
  @Prop({ required: true })
  tempId: string;

  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  date: string;

  @Prop({ required: true, maxlength: 500 })
  description: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  currency: string;

  @Prop({ min: 1, max: 120 })
  cuotaActual?: number;

  @Prop({ min: 1, max: 120 })
  cuotaTotal?: number;

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({
    type: String,
    enum: StatementLineSource,
    default: StatementLineSource.REGEX,
  })
  parsedVia: StatementLineSource;

  @Prop({ default: false })
  isPossibleDuplicate: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Expense', required: false })
  duplicateOfExpenseId?: Types.ObjectId;

  /** Denormalized so the review screen can show what it matched without a second lookup. */
  @Prop({ maxlength: 500 })
  duplicateOfDescription?: string;

  @Prop()
  duplicateOfAmount?: number;

  @Prop({ match: /^\d{4}-\d{2}-\d{2}$/ })
  duplicateOfDate?: string;

  @Prop({ maxlength: 1000 })
  rawText?: string;
}

export const StatementImportLineSchema =
  SchemaFactory.createForClass(StatementImportLine);

@Schema({ timestamps: true, collection: 'statementimportsessions' })
export class StatementImportSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  boardId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: true })
  paymentMethodId: Types.ObjectId;

  @Prop({ type: [StatementImportLineSchema], default: [] })
  lines: StatementImportLine[];

  @Prop({ default: false })
  lowConfidenceDocument: boolean;

  /**
   * Union of the parsed lines' own date range and the card's confirmed
   * billing cycle overlapping it (if any) — the window the frontend uses
   * to show already-loaded expenses for reconciliation.
   */
  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  periodFrom: string;

  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  periodTo: string;

  /** TTL: pending imports the user never confirms are cleaned up automatically. */
  @Prop({ default: Date.now, expires: 60 * 60 })
  expiresAt: Date;
}

export type StatementImportSessionDocument = StatementImportSession & Document;

export const StatementImportSessionSchema = SchemaFactory.createForClass(
  StatementImportSession,
);
StatementImportSessionSchema.index({ userId: 1 });
