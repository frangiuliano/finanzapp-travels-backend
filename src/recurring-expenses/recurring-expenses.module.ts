import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringExpensesService } from './recurring-expenses.service';
import { RecurringExpensesController } from './recurring-expenses.controller';
import {
  RecurringExpense,
  RecurringExpenseSchema,
} from './recurring-expense.schema';
import {
  RecurringExpenseVersion,
  RecurringExpenseVersionSchema,
} from './recurring-expense-version.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';
import { RecurringMaterializationModule } from '../recurring-materialization/recurring-materialization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecurringExpense.name, schema: RecurringExpenseSchema },
      {
        name: RecurringExpenseVersion.name,
        schema: RecurringExpenseVersionSchema,
      },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
    RecurringMaterializationModule,
  ],
  controllers: [RecurringExpensesController],
  providers: [RecurringExpensesService],
  exports: [RecurringExpensesService, MongooseModule],
})
export class RecurringExpensesModule {}
