import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IncomesService } from './incomes.service';
import { IncomesController } from './incomes.controller';
import { Income, IncomeSchema } from './income.schema';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Income.name, schema: IncomeSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
  ],
  controllers: [IncomesController],
  providers: [IncomesService],
  exports: [IncomesService, MongooseModule],
})
export class IncomesModule {}
