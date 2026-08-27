import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum HoldingType {
  BANK_ACCOUNT = 'bank_account',
  VIRTUAL_WALLET = 'virtual_wallet',
  CASH = 'cash',
  INVESTMENT = 'investment',
  OTHER = 'other',
}

@Schema({ timestamps: true, collection: 'holdings' })
export class Holding {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  name: string;

  @Prop({ type: String, enum: HoldingType, required: true })
  type: HoldingType;

  @Prop({ maxlength: 100, trim: true })
  institution?: string;

  @Prop({ required: true, maxlength: 3, uppercase: true })
  currency: string;

  @Prop({ required: true, min: 0 })
  currentBalance: number;

  @Prop({ required: true, default: 0, min: 0 })
  allocatedBalance: number;

  @Prop({ default: true })
  isActive: boolean;
}

export type HoldingDocument = Holding & Document;
export const HoldingSchema = SchemaFactory.createForClass(Holding);
HoldingSchema.index({ userId: 1, isActive: 1, currency: 1 });

export enum SavingsGoalStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true, collection: 'savingsgoals' })
export class SavingsGoal {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  name: string;

  @Prop({ required: true, min: 0.01 })
  targetAmount: number;

  @Prop({ required: true, maxlength: 3, uppercase: true })
  currency: string;

  @Prop()
  targetDate?: Date;

  @Prop({ min: 0.01 })
  plannedMonthlyContribution?: number;

  @Prop({ min: 1, max: 10, default: 5 })
  priority: number;

  @Prop({ maxlength: 10, trim: true })
  icon?: string;

  @Prop({
    type: String,
    enum: SavingsGoalStatus,
    default: SavingsGoalStatus.ACTIVE,
  })
  status: SavingsGoalStatus;
}

export type SavingsGoalDocument = SavingsGoal & Document;
export const SavingsGoalSchema = SchemaFactory.createForClass(SavingsGoal);
SavingsGoalSchema.index({ userId: 1, status: 1, priority: 1 });

@Schema({ timestamps: true, collection: 'goalallocations' })
export class GoalAllocation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SavingsGoal', required: true })
  goalId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Holding', required: true })
  holdingId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;
}

export type GoalAllocationDocument = GoalAllocation & Document;
export const GoalAllocationSchema =
  SchemaFactory.createForClass(GoalAllocation);
GoalAllocationSchema.index({ goalId: 1, holdingId: 1 }, { unique: true });
GoalAllocationSchema.index({ userId: 1, holdingId: 1 });

export enum WealthEventKind {
  INITIAL_BALANCE = 'initial_balance',
  BALANCE_ADJUSTMENT = 'balance_adjustment',
  CONTRIBUTION = 'contribution',
  WITHDRAWAL = 'withdrawal',
}

@Schema({ timestamps: true, collection: 'wealthevents' })
export class WealthEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Holding', required: true })
  holdingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SavingsGoal' })
  goalId?: Types.ObjectId;

  @Prop({ type: String, enum: WealthEventKind, required: true })
  kind: WealthEventKind;

  @Prop({ required: true })
  amount: number;

  @Prop()
  balanceAfter?: number;

  @Prop()
  allocationAfter?: number;

  @Prop({ maxlength: 200, trim: true })
  note?: string;

  @Prop({ required: true, default: Date.now })
  occurredAt: Date;
}

export type WealthEventDocument = WealthEvent & Document;
export const WealthEventSchema = SchemaFactory.createForClass(WealthEvent);
WealthEventSchema.index({ userId: 1, occurredAt: -1 });
WealthEventSchema.index({ goalId: 1, occurredAt: -1 });
