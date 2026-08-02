import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingPeriod, BillingPeriodSchema } from './billing-period.schema';
import { BillingPeriodsService } from './billing-periods.service';
import { BillingPeriodsController } from './billing-periods.controller';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { InAppNotificationsModule } from '../in-app-notifications/in-app-notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BillingPeriod.name, schema: BillingPeriodSchema },
    ]),
    PaymentMethodsModule,
    forwardRef(() => InAppNotificationsModule),
  ],
  controllers: [BillingPeriodsController],
  providers: [BillingPeriodsService],
  exports: [BillingPeriodsService, MongooseModule],
})
export class BillingPeriodsModule {}
