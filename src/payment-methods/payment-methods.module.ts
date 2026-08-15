import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethod, PaymentMethodSchema } from './payment-method.schema';
import { ParticipantsModule } from '../participants/participants.module';
import { Card, CardSchema } from '../cards/card.schema';
import {
  PaymentMethodBoardExclusion,
  PaymentMethodBoardExclusionSchema,
} from './payment-method-board-exclusion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: Card.name, schema: CardSchema },
      {
        name: PaymentMethodBoardExclusion.name,
        schema: PaymentMethodBoardExclusionSchema,
      },
    ]),
    forwardRef(() => ParticipantsModule),
  ],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
  exports: [PaymentMethodsService, MongooseModule],
})
export class PaymentMethodsModule {}
