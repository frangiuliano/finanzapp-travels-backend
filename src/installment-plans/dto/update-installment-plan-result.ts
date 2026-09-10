import { InstallmentOverridePolicy } from './update-installment-plan.dto';
import { InstallmentPlan } from '../installment-plan.schema';

export interface InstallmentCustomOverrideItem {
  installmentNumber: number;
  description: string;
  amount: number;
  currency: string;
  overriddenFields: string[];
}

export interface InstallmentCustomOverridesInfo {
  count: number;
  items: InstallmentCustomOverrideItem[];
}

export interface InstallmentPlanUpdateNeedsDecision {
  status: 'needs_decision';
  customOverrides: InstallmentCustomOverridesInfo;
}

export interface InstallmentPlanUpdateApplied {
  status: 'applied';
  installmentPlan: InstallmentPlan & { paidCount: number };
  applied: {
    datesUpdated: number;
    overridePolicy?: InstallmentOverridePolicy;
    overridesPreserved: number;
    overridesReplaced: number;
  };
}

export type InstallmentPlanUpdateResult =
  InstallmentPlanUpdateNeedsDecision | InstallmentPlanUpdateApplied;
