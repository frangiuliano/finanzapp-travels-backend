import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum GoalStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true, collection: 'goals' })
export class Goal {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true, index: true })
  boardId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, maxlength: 100, trim: true })
  name: string;

  @Prop({ maxlength: 10, trim: true })
  icon?: string;

  @Prop({ required: true, min: 0.01 })
  targetAmount: number;

  @Prop({ required: true, maxlength: 3, uppercase: true })
  currency: string;

  @Prop()
  targetDate?: Date;

  @Prop({ min: 0.01 })
  desiredMonthlyContribution?: number;

  @Prop({ required: true, min: 1, max: 10, default: 5 })
  priority: number;

  @Prop({ type: String, enum: GoalStatus, default: GoalStatus.ACTIVE })
  status: GoalStatus;

  /**
   * Opt-in: apply a live FX conversion to MonthlyForecast.projectedRemaining
   * when this goal's currency differs from the board's baseCurrency. Off by
   * default — mismatched-currency capacity is reported as not computable
   * rather than silently converted (see GoalsPlannerService).
   */
  @Prop({ default: false })
  useEstimatedFxForForecast: boolean;

  /** Set once, during the SavingsGoal -> Goal migration, for traceability. */
  @Prop({ type: Types.ObjectId, ref: 'SavingsGoal' })
  legacySavingsGoalId?: Types.ObjectId;
}
export type GoalDocument = Goal & Document;
export const GoalSchema = SchemaFactory.createForClass(Goal);
GoalSchema.index({ boardId: 1, status: 1, priority: 1 });
GoalSchema.index({ boardId: 1, createdAt: 1 });

/**
 * A pure reference: "this holding may count toward this goal's viability."
 * Unlike the legacy GoalAllocation, it carries no amount and never mutates a
 * Holding's balance — selecting/unselecting a holding here has zero effect
 * on Holding.currentBalance or Holding.allocatedBalance.
 */
@Schema({ timestamps: true, collection: 'goal_holding_selections' })
export class GoalHoldingSelection {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true, index: true })
  boardId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Goal', required: true })
  goalId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Holding', required: true })
  holdingId: Types.ObjectId;

  /**
   * Opt-in: convert this holding's value into the goal's currency using a
   * live FX rate when currencies differ. Off by default — a currency
   * mismatch is shown as "no computable" rather than silently converted.
   */
  @Prop({ default: false })
  useEstimatedFx: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  selectedBy: Types.ObjectId;
}
export type GoalHoldingSelectionDocument = GoalHoldingSelection & Document;
export const GoalHoldingSelectionSchema =
  SchemaFactory.createForClass(GoalHoldingSelection);
GoalHoldingSelectionSchema.index({ goalId: 1, holdingId: 1 }, { unique: true });
GoalHoldingSelectionSchema.index({ boardId: 1, holdingId: 1 });

interface GoalCheckpointHoldingValue {
  holdingId: Types.ObjectId;
  currency: string;
  value: number;
  computable: boolean;
}

/**
 * A monthly snapshot of a goal's considered capital, captured lazily and
 * idempotently (one per {goalId, yearMonth}) the first time the goal is read
 * in a new calendar month. Used to measure "avance neto observado" without
 * assuming every balance increase is savings (investment revaluation isn't).
 */
@Schema({ timestamps: true, collection: 'goal_checkpoints' })
export class GoalCheckpoint {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true, index: true })
  boardId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Goal', required: true })
  goalId: Types.ObjectId;

  @Prop({ required: true, maxlength: 7 })
  yearMonth: string;

  @Prop({ required: true, min: 0 })
  totalConsideredValue: number;

  @Prop({ type: [Object], default: [] })
  valueByHolding: GoalCheckpointHoldingValue[];

  /** True for the checkpoint created by the SavingsGoal migration itself. */
  @Prop({ default: false })
  isBaseline: boolean;

  @Prop({ required: true, default: Date.now })
  capturedAt: Date;
}
export type GoalCheckpointDocument = GoalCheckpoint & Document;
export const GoalCheckpointSchema =
  SchemaFactory.createForClass(GoalCheckpoint);
GoalCheckpointSchema.index({ goalId: 1, yearMonth: 1 }, { unique: true });
