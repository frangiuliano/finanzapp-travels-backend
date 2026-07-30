import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { Expense, ExpenseSchema } from './expense.schema';
import { Budget, BudgetSchema } from '../budgets/budget.schema';
import {
  Participant,
  ParticipantSchema,
} from '../participants/schemas/participant.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BudgetsModule),
    forwardRef(() => BoardsModule),
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService, MongooseModule],
})
export class ExpensesModule {}
