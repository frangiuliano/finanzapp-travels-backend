import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { Trip, TripSchema } from './trip.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { Budget, BudgetSchema } from '../budgets/budget.schema';
import {
  Invitation,
  InvitationSchema,
} from '../participants/schemas/invitation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Trip.name, schema: TripSchema },
      { name: Budget.name, schema: BudgetSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    forwardRef(() => ParticipantsModule),
  ],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService, MongooseModule],
})
export class TripsModule {}
