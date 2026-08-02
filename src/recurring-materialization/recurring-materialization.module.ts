import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringMaterializationService } from './recurring-materialization.service';
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
import { Income, IncomeSchema } from '../incomes/income.schema';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import {
  Participant,
  ParticipantSchema,
} from '../participants/schemas/participant.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { FxModule } from '../fx/fx.module';
import { BoardsModule } from '../trips/trips.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';

@Module({
  imports: [
    MongooseModule.forFeature([
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
      { name: Income.name, schema: IncomeSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    FxModule,
    forwardRef(() => BoardsModule),
    forwardRef(() => PaymentMethodsModule),
  ],
  providers: [RecurringMaterializationService],
  exports: [RecurringMaterializationService],
})
export class RecurringMaterializationModule {}
