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
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

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

  @Prop({ min: 0 })
  cashBalance?: number;

  @Prop({ default: true })
  isActive: boolean;
}

export type HoldingDocument = Holding & Document;
export const HoldingSchema = SchemaFactory.createForClass(Holding);
HoldingSchema.index({ boardId: 1, isActive: 1, currency: 1 });

export enum SavingsGoalStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true, collection: 'savingsgoals' })
export class SavingsGoal {
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

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
SavingsGoalSchema.index({ boardId: 1, status: 1, priority: 1 });

@Schema({ timestamps: true, collection: 'goalallocations' })
export class GoalAllocation {
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

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
GoalAllocationSchema.index({ boardId: 1, holdingId: 1 });

export enum WealthEventKind {
  INITIAL_BALANCE = 'initial_balance',
  BALANCE_ADJUSTMENT = 'balance_adjustment',
  CONTRIBUTION = 'contribution',
  WITHDRAWAL = 'withdrawal',
}

@Schema({ timestamps: true, collection: 'wealthevents' })
export class WealthEvent {
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

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
WealthEventSchema.index({ boardId: 1, occurredAt: -1 });
WealthEventSchema.index({ goalId: 1, occurredAt: -1 });

export enum InstrumentType {
  STOCK = 'stock',
  ETF = 'etf',
  CEDEAR = 'cedear',
  BOND = 'bond',
  MUTUAL_FUND = 'mutual_fund',
  CRYPTO = 'crypto',
  OTHER = 'other',
}

@Schema({ timestamps: true, collection: 'financialinstruments' })
export class FinancialInstrument {
  @Prop({ required: true, uppercase: true, trim: true, maxlength: 30 })
  symbol: string;
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;
  @Prop({ type: String, enum: InstrumentType, required: true })
  type: InstrumentType;
  @Prop({ required: true, uppercase: true, maxlength: 3 })
  currency: string;
  @Prop({ trim: true, maxlength: 50 })
  exchange?: string;
  @Prop({ trim: true, maxlength: 30 })
  micCode?: string;
  @Prop({ trim: true, maxlength: 30 })
  provider?: string;
  @Prop({ trim: true, maxlength: 80 })
  providerSymbol?: string;
  @Prop({ min: 0 })
  lastPrice?: number;
  @Prop()
  lastPriceAt?: Date;
  @Prop({ default: true })
  isSystem: boolean;
  @Prop({ default: true })
  isActive: boolean;
  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}
export type FinancialInstrumentDocument = FinancialInstrument & Document;
export const FinancialInstrumentSchema =
  SchemaFactory.createForClass(FinancialInstrument);
FinancialInstrumentSchema.index({ symbol: 1, exchange: 1 }, { unique: true });

@Schema({ timestamps: true, collection: 'investmentpositions' })
export class InvestmentPosition {
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Holding', required: true })
  holdingId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'FinancialInstrument', required: true })
  instrumentId: Types.ObjectId;
  @Prop({ required: true, min: 0 }) quantity: number;
  @Prop({ required: true, min: 0 }) averageCost: number;
  @Prop({ required: true, min: 0 }) currentPrice: number;
  @Prop({ default: true }) isOpen: boolean;
}
export type InvestmentPositionDocument = InvestmentPosition & Document;
export const InvestmentPositionSchema =
  SchemaFactory.createForClass(InvestmentPosition);
InvestmentPositionSchema.index(
  { holdingId: 1, instrumentId: 1 },
  { unique: true },
);

export enum InvestmentTransactionType {
  BUY = 'buy',
  SELL = 'sell',
}
@Schema({ timestamps: true, collection: 'investmenttransactions' })
export class InvestmentTransaction {
  @Prop({ type: Types.ObjectId, ref: 'Board', index: true })
  boardId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Holding', required: true })
  holdingId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'FinancialInstrument', required: true })
  instrumentId: Types.ObjectId;
  @Prop({ type: String, enum: InvestmentTransactionType, required: true })
  type: InvestmentTransactionType;
  @Prop({ required: true, min: 0.00000001 }) quantity: number;
  @Prop({ required: true, min: 0 }) unitPrice: number;
  @Prop({ default: 0, min: 0 }) fees: number;
  @Prop({ required: true, default: Date.now }) occurredAt: Date;
  @Prop({ maxlength: 200, trim: true }) note?: string;
  @Prop({ default: false }) isVoided: boolean;
  @Prop({ type: [Object], default: [] })
  correctionHistory: Array<Record<string, unknown>>;
}
export type InvestmentTransactionDocument = InvestmentTransaction & Document;
export const InvestmentTransactionSchema = SchemaFactory.createForClass(
  InvestmentTransaction,
);
InvestmentTransactionSchema.index({ holdingId: 1, occurredAt: -1 });
