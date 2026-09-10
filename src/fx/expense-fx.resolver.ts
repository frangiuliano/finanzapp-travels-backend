import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExpenseFxPolicy, ExpenseFxPurpose } from '../expenses/expense.schema';
import { FxService } from './fx.service';

export interface ExpenseFxOnCreate {
  fxPolicy?: ExpenseFxPolicy;
  fxPurpose?: ExpenseFxPurpose;
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
  expenseDate?: Date | string;
}

@Injectable()
export class ExpenseFxResolver {
  constructor(private readonly fxService: FxService) {}

  buildFxOnCreate(params: {
    expenseCurrency: string;
    boardCurrency: string;
  }): ExpenseFxOnCreate | null {
    const { expenseCurrency, boardCurrency } = params;

    if (expenseCurrency === boardCurrency) {
      return null;
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

  resolveDisplayFx(
    expense: ExpenseFxSource,
    boardCurrency: string,
  ): ExpenseDisplayFx | null {
    if (expense.currency === boardCurrency) {
      return {
        rate: 1,
        amountInBoardCurrency: expense.amount,
        purpose: ExpenseFxPurpose.SETTLED,
        isLive: false,
        boardCurrency,
      };
    }

    const rate = expense.fxRateToBoardCurrency;
    if (rate == null || rate <= 0) {
      return null;
    }

    return {
      rate,
      amountInBoardCurrency: expense.amount * rate,
      purpose: expense.fxPurpose ?? ExpenseFxPurpose.SETTLED,
      isLive: false,
      boardCurrency,
    };
  }

  getAmountInBoardCurrency(
    expense: ExpenseFxSource,
    boardCurrency: string,
  ): number | null {
    const displayFx = this.resolveDisplayFx(expense, boardCurrency);
    return displayFx?.amountInBoardCurrency ?? null;
  }
}
