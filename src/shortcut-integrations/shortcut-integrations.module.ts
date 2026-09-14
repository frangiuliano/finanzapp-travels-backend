import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BudgetsModule } from '../budgets/budgets.module';
import { CategoriesModule } from '../categories/categories.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ParticipantsModule } from '../participants/participants.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { BoardsModule } from '../trips/trips.module';
import { User, UserSchema } from '../users/user.schema';
import { AdaptiveExpenseParserService } from './adaptive-expense-parser.service';
import { ShortcutCaptureController } from './shortcut-capture.controller';
import {
  ShortcutIntegrationToken,
  ShortcutIntegrationTokenSchema,
} from './shortcut-integration.schema';
import { ShortcutIntegrationsController } from './shortcut-integrations.controller';
import { ShortcutIntegrationsService } from './shortcut-integrations.service';
import { ShortcutTokenGuard } from './shortcut-token.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ShortcutIntegrationToken.name,
        schema: ShortcutIntegrationTokenSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
    BoardsModule,
    CategoriesModule,
    PaymentMethodsModule,
    ParticipantsModule,
    BudgetsModule,
    ExpensesModule,
  ],
  controllers: [ShortcutIntegrationsController, ShortcutCaptureController],
  providers: [
    ShortcutIntegrationsService,
    ShortcutTokenGuard,
    AdaptiveExpenseParserService,
  ],
})
export class ShortcutIntegrationsModule {}
