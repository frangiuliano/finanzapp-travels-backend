import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import { Income, IncomeSchema } from '../incomes/income.schema';
import { Category, CategorySchema } from '../categories/category.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../payment-methods/payment-method.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: Income.name, schema: IncomeSchema },
      { name: Category.name, schema: CategorySchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
