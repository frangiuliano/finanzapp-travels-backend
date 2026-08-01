import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BotUpdate,
  BotUpdateDocument,
  ConversationState,
} from '../bot-update.schema';
import { BoardsService } from '../../trips/trips.service';
import { UserPreferencesService } from '../../users/user-preferences.service';

@Injectable()
export class BotUpdateRepository {
  constructor(
    @InjectModel(BotUpdate.name)
    public botUpdateModel: Model<BotUpdateDocument>,
    private boardsService: BoardsService,
    private userPreferencesService: UserPreferencesService,
  ) {}

  async getOrCreateBotUpdate(
    telegramUserId: number,
  ): Promise<BotUpdateDocument> {
    let botUpdate = await this.botUpdateModel
      .findOne({ telegramUserId })
      .exec();

    if (!botUpdate) {
      botUpdate = new this.botUpdateModel({
        telegramUserId,
        state: ConversationState.IDLE,
      });
      await botUpdate.save();
    }

    return botUpdate;
  }

  async determineActiveBoardId(
    botUpdate: BotUpdateDocument,
  ): Promise<string | null> {
    if (!botUpdate.userId) {
      return null;
    }

    const userId = botUpdate.userId.toString();
    const preferredId =
      await this.userPreferencesService.getActiveBoardId(userId);

    if (preferredId) {
      try {
        await this.boardsService.findOne(preferredId, userId);
        botUpdate.currentTripId = new Types.ObjectId(preferredId);
        await botUpdate.save();
        return preferredId;
      } catch {
        await this.userPreferencesService.setActiveBoardId(userId, null);
      }
    }

    if (botUpdate.currentTripId) {
      try {
        await this.boardsService.findOne(
          botUpdate.currentTripId.toString(),
          userId,
        );
        return botUpdate.currentTripId.toString();
      } catch {
        // stale session board
      }
    }

    const boards = await this.boardsService.findAll(userId);
    if (boards.length === 0) {
      return null;
    }

    const firstBoard = boards[0] as unknown as { _id: Types.ObjectId };
    const boardId = firstBoard._id.toString();
    botUpdate.currentTripId = new Types.ObjectId(boardId);
    await botUpdate.save();
    return boardId;
  }

  /** @deprecated Use determineActiveBoardId */
  async determineActiveTrip(
    botUpdate: BotUpdateDocument,
  ): Promise<string | null> {
    return this.determineActiveBoardId(botUpdate);
  }
}
