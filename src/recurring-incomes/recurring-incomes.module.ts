import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringIncomesService } from './recurring-incomes.service';
import { RecurringIncomesController } from './recurring-incomes.controller';
import {
  RecurringIncome,
  RecurringIncomeSchema,
} from './recurring-income.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecurringIncome.name, schema: RecurringIncomeSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
  ],
  controllers: [RecurringIncomesController],
  providers: [RecurringIncomesService],
  exports: [RecurringIncomesService, MongooseModule],
})
export class RecurringIncomesModule {}
