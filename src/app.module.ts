import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './trips/trips.module';
import { ParticipantsModule } from './participants/participants.module';
import { BudgetsModule } from './budgets/budgets.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BotModule } from './bot/bot.module';
import { CardsModule } from './cards/cards.module';
import { CategoriesModule } from './categories/categories.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { IncomesModule } from './incomes/incomes.module';
import { BoardMonthBudgetsModule } from './board-month-budgets/board-month-budgets.module';
import { ReportsModule } from './reports/reports.module';
import { RecurringIncomesModule } from './recurring-incomes/recurring-incomes.module';
import { RecurringExpensesModule } from './recurring-expenses/recurring-expenses.module';
import { InstallmentPlansModule } from './installment-plans/installment-plans.module';
import { ForecastModule } from './forecast/forecast.module';
import { InAppNotificationsModule } from './in-app-notifications/in-app-notifications.module';
import { BillingPeriodsModule } from './billing-periods/billing-periods.module';
import { WealthModule } from './wealth/wealth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI');
        return {
          uri,
          retryWrites: true,
          w: 'majority',
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    BoardsModule,
    ParticipantsModule,
    BudgetsModule,
    ExpensesModule,
    BotModule,
    CardsModule,
    CategoriesModule,
    PaymentMethodsModule,
    IncomesModule,
    BoardMonthBudgetsModule,
    ReportsModule,
    RecurringIncomesModule,
    RecurringExpensesModule,
    InstallmentPlansModule,
    ForecastModule,
    InAppNotificationsModule,
    BillingPeriodsModule,
    WealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
