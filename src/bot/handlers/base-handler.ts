import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BotUpdate, BotUpdateDocument } from '../bot-update.schema';
import { User, UserDocument } from '../../users/user.schema';
import { TelegramClientService } from '../telegram/telegram-client.service';
import { ConversationalService } from '../parsers/conversational.service';
import { TripsService } from '../../trips/trips.service';
import { ParticipantsService } from '../../participants/participants.service';
import { BudgetsService } from '../../budgets/budgets.service';
import { getUserName, getParticipantName } from '../utils/bot-helpers';
import {
  PopulatedParticipant,
  PopulatedBudget,
} from '../types/populated.types';

@Injectable()
export abstract class BaseHandler {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    @InjectModel(BotUpdate.name)
    protected botUpdateModel: Model<BotUpdateDocument>,
    @InjectModel(User.name)
    protected userModel: Model<UserDocument>,
    protected telegramClient: TelegramClientService,
    protected conversationalService: ConversationalService,
    protected tripsService: TripsService,
    protected participantsService: ParticipantsService,
    protected budgetsService: BudgetsService,
  ) {}

  protected getUserName(userId: string | undefined): Promise<string> {
    if (!userId) return Promise.resolve('Usuario');
    return this.userModel
      .findById(userId)
      .exec()
      .then((user) => getUserName(user));
  }

  protected buildParticipantsContext(
    participants: unknown[],
    userId: string | undefined,
  ): Array<{ id: string; name: string; isUser: boolean }> {
    const typedParticipants = participants as unknown as PopulatedParticipant[];
    return typedParticipants.map((p) => ({
      id: p._id.toString(),
      name: getParticipantName(p),
      isUser: !!(
        p.userId &&
        typeof p.userId === 'object' &&
        'firstName' in p.userId &&
        userId &&
        p.userId._id.toString() === userId
      ),
    }));
  }

  protected buildBudgetsContext(
    budgets: unknown[],
  ): Array<{ id: string; name: string }> {
    const typedBudgets = budgets as unknown as PopulatedBudget[];
    return typedBudgets.map((b) => ({
      id: b._id.toString(),
      name: b.name,
    }));
  }
}
