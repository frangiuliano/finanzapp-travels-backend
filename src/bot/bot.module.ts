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
  ],
  controllers: [BotController],
  providers: [
    BotService,
    MessageParserService,
    LLMParserService,
    ConversationalService,
  ],
  exports: [BotService],
})
export class BotModule {}
