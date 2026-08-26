import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BoardsService } from './trips.service';
import { BoardsController } from './trips.controller';
import { Board, BoardSchema } from './board.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { Budget, BudgetSchema } from '../budgets/budget.schema';
import {
  Invitation,
  InvitationSchema,
} from '../participants/schemas/invitation.schema';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import { Income, IncomeSchema } from '../incomes/income.schema';
import {
  RecurringIncome,
  RecurringIncomeSchema,
} from '../recurring-incomes/recurring-income.schema';
import {
  RecurringIncomeVersion,
  RecurringIncomeVersionSchema,
} from '../recurring-incomes/recurring-income-version.schema';
import {
  RecurringExpense,
  RecurringExpenseSchema,
} from '../recurring-expenses/recurring-expense.schema';
import {
  RecurringExpenseVersion,
  RecurringExpenseVersionSchema,
} from '../recurring-expenses/recurring-expense-version.schema';
import {
  InstallmentPlan,
  InstallmentPlanSchema,
} from '../installment-plans/installment-plan.schema';
import {
  BoardMonthBudget,
  BoardMonthBudgetSchema,
} from '../board-month-budgets/board-month-budget.schema';
import { Card, CardSchema } from '../cards/card.schema';
import { User, UserSchema } from '../users/user.schema';
import { BotUpdate, BotUpdateSchema } from '../bot/bot-update.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../payment-methods/payment-method.schema';
import {
  BillingPeriod,
  BillingPeriodSchema,
} from '../billing-periods/billing-period.schema';
import {
  InAppNotification,
  InAppNotificationSchema,
} from '../in-app-notifications/in-app-notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Income.name, schema: IncomeSchema },
      { name: RecurringIncome.name, schema: RecurringIncomeSchema },
      {
        name: RecurringIncomeVersion.name,
        schema: RecurringIncomeVersionSchema,
      },
      { name: RecurringExpense.name, schema: RecurringExpenseSchema },
      {
        name: RecurringExpenseVersion.name,
        schema: RecurringExpenseVersionSchema,
      },
      { name: InstallmentPlan.name, schema: InstallmentPlanSchema },
      { name: BoardMonthBudget.name, schema: BoardMonthBudgetSchema },
      { name: Card.name, schema: CardSchema },
      { name: User.name, schema: UserSchema },
      { name: BotUpdate.name, schema: BotUpdateSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: BillingPeriod.name, schema: BillingPeriodSchema },
      {
        name: InAppNotification.name,
        schema: InAppNotificationSchema,
      },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => CategoriesModule),
    forwardRef(() => PaymentMethodsModule),
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService, MongooseModule],
})
export class BoardsModule {}

/** @deprecated Use BoardsModule */
export { BoardsModule as TripsModule };
