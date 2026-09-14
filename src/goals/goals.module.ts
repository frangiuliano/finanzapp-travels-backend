import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { GoalsPlannerService } from './goals-planner.service';
import { ParticipantsModule } from '../participants/participants.module';
import { ForecastModule } from '../forecast/forecast.module';
import { FxModule } from '../fx/fx.module';
import { Board, BoardSchema } from '../trips/board.schema';
import { Holding, HoldingSchema } from '../wealth/wealth.schemas';
import {
  Goal,
  GoalCheckpoint,
  GoalCheckpointSchema,
  GoalHoldingSelection,
  GoalHoldingSelectionSchema,
  GoalSchema,
} from './goals.schemas';

@Module({
  imports: [
    ParticipantsModule,
    ForecastModule,
    FxModule,
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: Holding.name, schema: HoldingSchema },
      { name: Goal.name, schema: GoalSchema },
      { name: GoalHoldingSelection.name, schema: GoalHoldingSelectionSchema },
      { name: GoalCheckpoint.name, schema: GoalCheckpointSchema },
    ]),
  ],
  controllers: [GoalsController],
  providers: [GoalsService, GoalsPlannerService],
})
export class GoalsModule {}
