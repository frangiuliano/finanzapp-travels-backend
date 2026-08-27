import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WealthController } from './wealth.controller';
import { WealthService } from './wealth.service';
import {
  GoalAllocation,
  GoalAllocationSchema,
  Holding,
  HoldingSchema,
  SavingsGoal,
  SavingsGoalSchema,
  WealthEvent,
  WealthEventSchema,
  FinancialInstrument,
  FinancialInstrumentSchema,
  InvestmentPosition,
  InvestmentPositionSchema,
  InvestmentTransaction,
  InvestmentTransactionSchema,
} from './wealth.schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Holding.name, schema: HoldingSchema },
      { name: SavingsGoal.name, schema: SavingsGoalSchema },
      { name: GoalAllocation.name, schema: GoalAllocationSchema },
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
  providers: [WealthService],
})
export class WealthModule {}
