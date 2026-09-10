import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InstallmentPlansService } from './installment-plans.service';
import { InstallmentPlansController } from './installment-plans.controller';
import {
  InstallmentPlan,
  InstallmentPlanSchema,
} from './installment-plan.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { BoardsModule } from '../trips/trips.module';
import { FxModule } from '../fx/fx.module';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';
import {
  Participant,
  ParticipantSchema,
} from '../participants/schemas/participant.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstallmentPlan.name, schema: InstallmentPlanSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
    FxModule,
  ],
  controllers: [InstallmentPlansController],
  providers: [InstallmentPlansService],
  exports: [InstallmentPlansService, MongooseModule],
})
export class InstallmentPlansModule {}
