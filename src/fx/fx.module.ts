import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { ExpenseFxResolver } from './expense-fx.resolver';
import { Expense, ExpenseSchema } from '../expenses/expense.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Expense.name, schema: ExpenseSchema }]),
  ],
  controllers: [FxController],
  providers: [FxService, ExpenseFxResolver],
  exports: [FxService, ExpenseFxResolver],
})
export class FxModule {}
