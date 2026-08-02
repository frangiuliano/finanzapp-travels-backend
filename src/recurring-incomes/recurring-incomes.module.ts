import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecurringIncomesService } from './recurring-incomes.service';
import { RecurringIncomesController } from './recurring-incomes.controller';
import {
  RecurringIncome,
  RecurringIncomeSchema,
} from './recurring-income.schema';
import {
  RecurringIncomeVersion,
  RecurringIncomeVersionSchema,
} from './recurring-income-version.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';
import { RecurringMaterializationModule } from '../recurring-materialization/recurring-materialization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecurringIncome.name, schema: RecurringIncomeSchema },
      {
        name: RecurringIncomeVersion.name,
        schema: RecurringIncomeVersionSchema,
      },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
    RecurringMaterializationModule,
  ],
  controllers: [RecurringIncomesController],
  providers: [RecurringIncomesService],
  exports: [RecurringIncomesService, MongooseModule],
})
export class RecurringIncomesModule {}
