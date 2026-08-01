import { Module } from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { ForecastController } from './forecast.controller';
import { IncomesModule } from '../incomes/incomes.module';
import { RecurringIncomesModule } from '../recurring-incomes/recurring-incomes.module';
import { RecurringExpensesModule } from '../recurring-expenses/recurring-expenses.module';
import { InstallmentPlansModule } from '../installment-plans/installment-plans.module';

@Module({
  imports: [
    IncomesModule,
    RecurringIncomesModule,
    RecurringExpensesModule,
    InstallmentPlansModule,
  ],
  controllers: [ForecastController],
  providers: [ForecastService],
  exports: [ForecastService],
})
export class ForecastModule {}
