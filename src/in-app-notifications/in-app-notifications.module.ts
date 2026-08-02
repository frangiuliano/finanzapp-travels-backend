import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InAppNotification,
  InAppNotificationSchema,
} from './in-app-notification.schema';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { BillingPeriodsModule } from '../billing-periods/billing-periods.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InAppNotification.name, schema: InAppNotificationSchema },
    ]),
    forwardRef(() => BillingPeriodsModule),
  ],
  controllers: [InAppNotificationsController],
  providers: [InAppNotificationsService],
  exports: [InAppNotificationsService, MongooseModule],
})
export class InAppNotificationsModule {}
