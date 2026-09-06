import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StatementImportsController } from './statement-imports.controller';
import { StatementImportsService } from './statement-imports.service';
import {
  StatementImportSession,
  StatementImportSessionSchema,
} from './statement-import-session.schema';
import { StatementLlmFallbackService } from './parsing/statement-llm-fallback.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: StatementImportSession.name,
        schema: StatementImportSessionSchema,
      },
    ]),
    ExpensesModule,
    PaymentMethodsModule,
  ],
  controllers: [StatementImportsController],
  providers: [StatementImportsService, StatementLlmFallbackService],
})
export class StatementImportsModule {}
