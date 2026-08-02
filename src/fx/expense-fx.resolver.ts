import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Expense,
  ExpenseDocument,
  ExpenseFxPolicy,
  ExpenseFxPurpose,
} from '../expenses/expense.schema';
import { PaymentMethodKind } from '../payment-methods/payment-method.schema';
import {
  getCreditCycleRange,
  isCycleClosed,
  resolveCycleClosingMonth,
} from '../common/utils/credit-cycle';
import { FxService } from './fx.service';

export interface PaymentMethodFxContext {
  kind?: PaymentMethodKind;
  closingDay?: number;
}

export interface ExpenseFxOnCreate {
  fxPolicy?: ExpenseFxPolicy;
  fxPurpose?: ExpenseFxPurpose;
  billingCycleLabel?: string;
  fxRateToBoardCurrency?: number;
  fxCapturedAt?: Date;
}

export interface ExpenseDisplayFx {
  rate: number;
  amountInBoardCurrency: number;
  purpose: ExpenseFxPurpose;
  isLive: boolean;
  boardCurrency: string;
}

export interface ExpenseFxSource {
  _id?: Types.ObjectId | string;
  amount: number;
  currency: string;
  fxRateToBoardCurrency?: number | null;
  fxCapturedAt?: Date | string | null;
  fxPolicy?: ExpenseFxPolicy | null;
  fxPurpose?: ExpenseFxPurpose | null;
  billingCycleLabel?: string | null;
  expenseDate?: Date | string;
}

@Injectable()
export class ExpenseFxResolver {
  constructor(
    private readonly fxService: FxService,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
  ) {}

  buildFxOnCreate(params: {
    expenseCurrency: string;
    boardCurrency: string;
    expenseDate: Date;
    manualRate?: number;
    paymentMethod?: PaymentMethodFxContext | null;
  }): ExpenseFxOnCreate | null {
    const {
      expenseCurrency,
      boardCurrency,
      expenseDate,
      manualRate,
      paymentMethod,
    } = params;

    if (expenseCurrency === boardCurrency) {
      return null;
    }

    const isCreditCycle =
      paymentMethod?.kind === PaymentMethodKind.CREDIT &&
      paymentMethod.closingDay != null;

    if (isCreditCycle) {
      const billingCycleLabel = resolveCycleClosingMonth(
        expenseDate,
        paymentMethod.closingDay!,
      );

      return {
        fxPolicy: ExpenseFxPolicy.CREDIT_CYCLE,
        fxPurpose: ExpenseFxPurpose.REFERENTIAL,
        billingCycleLabel,
        fxRateToBoardCurrency: manualRate,
        fxCapturedAt: manualRate !== undefined ? new Date() : undefined,
      };
    }

    return {
      fxPolicy: ExpenseFxPolicy.SPOT,
      fxPurpose: ExpenseFxPurpose.SETTLED,
    };
  }

  async resolveSpotSnapshot(
    expenseCurrency: string,
    boardCurrency: string,
    manualRate?: number,
  ): Promise<{ fxRateToBoardCurrency: number; fxCapturedAt: Date }> {
    const snapshot = await this.fxService.resolveSnapshot(
      expenseCurrency,
      boardCurrency,
      manualRate,
    );
    return {
      fxRateToBoardCurrency: snapshot.fxRateToBoardCurrency,
      fxCapturedAt: snapshot.fxCapturedAt,
    };
  }

  async resolveDisplayFx(
    expense: ExpenseFxSource,
    boardCurrency: string,
    paymentMethod?: PaymentMethodFxContext | null,
  ): Promise<ExpenseDisplayFx | null> {
    if (expense.currency === boardCurrency) {
      return {
        rate: 1,
        amountInBoardCurrency: expense.amount,
        purpose: ExpenseFxPurpose.SETTLED,
        isLive: false,
        boardCurrency,
      };
    }

    const policy = expense.fxPolicy ?? ExpenseFxPolicy.SPOT;
    const purpose = expense.fxPurpose ?? ExpenseFxPurpose.SETTLED;

    if (
      policy === ExpenseFxPolicy.SPOT ||
      purpose === ExpenseFxPurpose.SETTLED
    ) {
      const rate = expense.fxRateToBoardCurrency;
      if (rate == null || rate <= 0) {
        return null;
      }

      return {
        rate,
        amountInBoardCurrency: expense.amount * rate,
        purpose: ExpenseFxPurpose.SETTLED,
        isLive: false,
        boardCurrency,
      };
    }

    const closingDay = paymentMethod?.closingDay;
    const cycleLabel = expense.billingCycleLabel;

    if (!closingDay || !cycleLabel) {
      if (
        expense.fxRateToBoardCurrency != null &&
        expense.fxRateToBoardCurrency > 0
      ) {
        return {
          rate: expense.fxRateToBoardCurrency,
          amountInBoardCurrency: expense.amount * expense.fxRateToBoardCurrency,
          purpose: ExpenseFxPurpose.REFERENTIAL,
          isLive: false,
          boardCurrency,
        };
      }
      return null;
    }

    if (!isCycleClosed(cycleLabel, closingDay)) {
      const snapshot = await this.fxService.resolveSnapshot(
        expense.currency,
        boardCurrency,
      );

      return {
        rate: snapshot.fxRateToBoardCurrency,
        amountInBoardCurrency: expense.amount * snapshot.fxRateToBoardCurrency,
        purpose: ExpenseFxPurpose.REFERENTIAL,
        isLive: true,
        boardCurrency,
      };
    }

    if (
      expense.fxPurpose === ExpenseFxPurpose.SETTLED &&
      expense.fxRateToBoardCurrency != null &&
      expense.fxRateToBoardCurrency > 0
    ) {
      return {
        rate: expense.fxRateToBoardCurrency,
        amountInBoardCurrency: expense.amount * expense.fxRateToBoardCurrency,
        purpose: ExpenseFxPurpose.SETTLED,
        isLive: false,
        boardCurrency,
      };
    }

    const { periodToInclusive } = getCreditCycleRange(cycleLabel, closingDay);
    const historical = await this.fxService.resolveHistoricalSnapshot(
      expense.currency,
      boardCurrency,
      periodToInclusive,
    );

    if (expense._id) {
      await this.expenseModel.updateOne(
        { _id: new Types.ObjectId(String(expense._id)) },
        {
          fxRateToBoardCurrency: historical.fxRateToBoardCurrency,
          fxCapturedAt: historical.fxCapturedAt,
          fxPurpose: ExpenseFxPurpose.SETTLED,
        },
      );
    }

    return {
      rate: historical.fxRateToBoardCurrency,
      amountInBoardCurrency: expense.amount * historical.fxRateToBoardCurrency,
      purpose: ExpenseFxPurpose.SETTLED,
      isLive: false,
      boardCurrency,
    };
  }

  async getAmountInBoardCurrency(
    expense: ExpenseFxSource,
    boardCurrency: string,
    paymentMethod?: PaymentMethodFxContext | null,
  ): Promise<number | null> {
    const displayFx = await this.resolveDisplayFx(
      expense,
      boardCurrency,
      paymentMethod,
    );
    return displayFx?.amountInBoardCurrency ?? null;
  }
}
