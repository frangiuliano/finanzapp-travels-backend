import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WealthController } from './wealth.controller';
import { WealthService } from './wealth.service';
import { ParticipantsModule } from '../participants/participants.module';
import { Board, BoardSchema } from '../trips/board.schema';
import { User, UserSchema } from '../users/user.schema';
import {
  Holding,
  HoldingSchema,
  WealthEvent,
  WealthEventSchema,
  FinancialInstrument,
  FinancialInstrumentSchema,
  InvestmentPosition,
  InvestmentPositionSchema,
  InvestmentTransaction,
  InvestmentTransactionSchema,
} from './wealth.schemas';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [
    ParticipantsModule,
    MongooseModule.forFeature([
      { name: Board.name, schema: BoardSchema },
      { name: User.name, schema: UserSchema },
      { name: Holding.name, schema: HoldingSchema },
      { name: WealthEvent.name, schema: WealthEventSchema },
      { name: FinancialInstrument.name, schema: FinancialInstrumentSchema },
      { name: InvestmentPosition.name, schema: InvestmentPositionSchema },
      {
        name: InvestmentTransaction.name,
        schema: InvestmentTransactionSchema,
      },
    ]),
  ],
  controllers: [WealthController],
  providers: [WealthService, MarketDataService],
})
export class WealthModule {}
