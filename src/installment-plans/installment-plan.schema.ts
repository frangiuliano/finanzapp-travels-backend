import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class InstallmentPlan {
  @Prop({ type: Types.ObjectId, ref: 'Board', required: true })
  tripId: Types.ObjectId;

  @Prop({ required: true, minlength: 1, maxlength: 200 })
  label: string;

  @Prop({ required: true, min: 0.01 })
  installmentAmount: number;

  @Prop({ required: true, min: 1, max: 120 })
  totalInstallments: number;

  @Prop({ required: true, min: 0, default: 0 })
  paidInstallments: number;

  /** First installment month in YYYY-MM format */
  @Prop({ required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ })
  startYearMonth: string;

  @Prop({ required: true, min: 1, max: 31 })
  dayOfMonth: number;

  @Prop({ type: Types.ObjectId, ref: 'PaymentMethod', required: false })
  paymentMethodId?: Types.ObjectId;

  @Prop({ required: true, default: 'USD' })
  currency: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type InstallmentPlanDocument = InstallmentPlan & Document;

export const InstallmentPlanSchema =
  SchemaFactory.createForClass(InstallmentPlan);

InstallmentPlanSchema.index({ tripId: 1, isActive: 1 });
