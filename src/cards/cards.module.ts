import { Module, forwardRef } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';

@Module({
  imports: [forwardRef(() => PaymentMethodsModule)],
  controllers: [CardsController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
