import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { Budget, BudgetSchema } from './budget.schema';
import { ParticipantsModule } from '../participants/participants.module';
import {
  Participant,
  ParticipantSchema,
} from '../participants/schemas/participant.schema';
import { BoardsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Budget.name, schema: BudgetSchema },
      { name: Participant.name, schema: ParticipantSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BoardsModule),
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService, MongooseModule],
})
export class BudgetsModule {}
