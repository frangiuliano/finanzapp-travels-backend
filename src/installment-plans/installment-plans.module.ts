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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstallmentPlan.name, schema: InstallmentPlanSchema },
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
