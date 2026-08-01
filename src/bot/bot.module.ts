import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { BotUpdate, BotUpdateSchema } from './bot-update.schema';
import {
  TelegramLinkToken,
  TelegramLinkTokenSchema,
} from './telegram-link-token.schema';
import { User, UserSchema } from '../users/user.schema';
import { MessageParserService } from './parsers/message-parser.service';
import { LLMParserService } from './parsers/llm-parser.service';
import { ConversationalService } from './parsers/conversational.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { TripsModule } from '../trips/trips.module';
import { ParticipantsModule } from '../participants/participants.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { CardsModule } from '../cards/cards.module';
import { CategoriesModule } from '../categories/categories.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { UsersModule } from '../users/users.module';
import { TelegramClientService } from './telegram/telegram-client.service';
import { UserLinkingService } from './linking/user-linking.service';
import { BotUpdateRepository } from './repositories/bot-update.repository';
import { BoardCommandHandler } from './handlers/board-command.handler';
import { EverydayExpenseHandler } from './handlers/everyday-expense.handler';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BotUpdate.name, schema: BotUpdateSchema },
      { name: TelegramLinkToken.name, schema: TelegramLinkTokenSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => ExpensesModule),
    forwardRef(() => TripsModule),
    forwardRef(() => ParticipantsModule),
    forwardRef(() => BudgetsModule),
    forwardRef(() => CardsModule),
    forwardRef(() => CategoriesModule),
    forwardRef(() => PaymentMethodsModule),
    UsersModule,
  ],
  controllers: [BotController],
  providers: [
    BotService,
    MessageParserService,
    LLMParserService,
    ConversationalService,
    TelegramClientService,
    UserLinkingService,
    BotUpdateRepository,
    BoardCommandHandler,
    EverydayExpenseHandler,
  ],
  exports: [BotService],
})
export class BotModule {}
