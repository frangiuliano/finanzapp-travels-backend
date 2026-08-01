import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BoardMonthBudgetsService } from './board-month-budgets.service';
import { BoardMonthBudgetsController } from './board-month-budgets.controller';
import {
  BoardMonthBudget,
  BoardMonthBudgetSchema,
} from './board-month-budget.schema';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BoardMonthBudget.name, schema: BoardMonthBudgetSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
    forwardRef(() => CategoriesModule),
  ],
  controllers: [BoardMonthBudgetsController],
  providers: [BoardMonthBudgetsService],
  exports: [BoardMonthBudgetsService, MongooseModule],
})
export class BoardMonthBudgetsModule {}
