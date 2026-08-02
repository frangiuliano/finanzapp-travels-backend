import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ForecastService } from './forecast.service';
import { ForecastController } from './forecast.controller';
import { IncomesModule } from '../incomes/incomes.module';
import { RecurringIncomesModule } from '../recurring-incomes/recurring-incomes.module';
import { RecurringExpensesModule } from '../recurring-expenses/recurring-expenses.module';
import { InstallmentPlansModule } from '../installment-plans/installment-plans.module';
import { RecurringMaterializationModule } from '../recurring-materialization/recurring-materialization.module';
import { FxModule } from '../fx/fx.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { Income, IncomeSchema } from '../incomes/income.schema';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Income.name, schema: IncomeSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    IncomesModule,
    RecurringIncomesModule,
    RecurringExpensesModule,
    InstallmentPlansModule,
    RecurringMaterializationModule,
    FxModule,
    PaymentMethodsModule,
  ],
  controllers: [ForecastController],
  providers: [ForecastService],
  exports: [ForecastService],
})
export class ForecastModule {}
