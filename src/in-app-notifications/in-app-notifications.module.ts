import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InAppNotification,
  InAppNotificationSchema,
} from './in-app-notification.schema';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotificationsController } from './in-app-notifications.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InAppNotification.name, schema: InAppNotificationSchema },
    ]),
  ],
  controllers: [InAppNotificationsController],
  providers: [InAppNotificationsService],
  exports: [InAppNotificationsService, MongooseModule],
})
export class InAppNotificationsModule {}
