import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { TripsModule } from './trips/trips.module';
import { ParticipantsModule } from './participants/participants.module';
import { BudgetsModule } from './budgets/budgets.module';
import { ExpensesModule } from './expenses/expenses.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minuto en milisegundos
        limit: 100, // 100 requests por minuto
      },
    ]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI');
        console.log('MongoDB URI:', uri);
        return {
          uri,
          retryWrites: true,
          w: 'majority',
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    TripsModule,
    ParticipantsModule,
    BudgetsModule,
    ExpensesModule,
    BotModule,
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
