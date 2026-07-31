import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BoardsService } from './trips.service';
import { BoardsController } from './trips.controller';
import { Board, BoardSchema } from './board.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { Budget, BudgetSchema } from '../budgets/budget.schema';
import {
  Invitation,
  InvitationSchema,
} from '../participants/schemas/invitation.schema';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => CategoriesModule),
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService, MongooseModule],
})
export class BoardsModule {}

/** @deprecated Use BoardsModule */
export { BoardsModule as TripsModule };
