import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParticipantsService } from './participants.service';
import { ParticipantsController } from './participants.controller';
import { Participant, ParticipantSchema } from './schemas/participant.schema';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { User, UserSchema } from '../users/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { TripsModule } from '../trips/trips.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Participant.name, schema: ParticipantSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => TripsModule),
    NotificationsModule,
  ],
  controllers: [ParticipantsController],
  providers: [ParticipantsService],
  exports: [ParticipantsService, MongooseModule],
})
export class ParticipantsModule {}
