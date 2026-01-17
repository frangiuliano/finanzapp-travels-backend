import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BotUpdate,
  BotUpdateDocument,
  ConversationState,
} from '../bot-update.schema';
import { TripsService } from '../../trips/trips.service';

@Injectable()
export class BotUpdateRepository {
  constructor(
    @InjectModel(BotUpdate.name)
    public botUpdateModel: Model<BotUpdateDocument>,
    private tripsService: TripsService,
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

  async determineActiveTrip(
    botUpdate: BotUpdateDocument,
  ): Promise<string | null> {
    if (botUpdate.currentTripId) {
      try {
        await this.tripsService.findOne(
          botUpdate.currentTripId.toString(),
          botUpdate.userId!.toString(),
        );
        return botUpdate.currentTripId.toString();
      } catch {
        // Trip no longer valid, will search for another one below
      }
    }

    const trips = await this.tripsService.findAll(botUpdate.userId!.toString());

    if (trips.length === 0) {
      return null;
    }

    if (trips.length === 1) {
      const firstTrip = trips[0] as unknown as {
        _id: Types.ObjectId;
      } & Record<string, unknown>;
      const tripId = firstTrip._id.toString();
      botUpdate.currentTripId = new Types.ObjectId(tripId);
      await botUpdate.save();
      return tripId;
    }

    const mostRecentTrip = trips[0] as unknown as {
      _id: Types.ObjectId;
    } & Record<string, unknown>;
    const tripId = mostRecentTrip._id.toString();
    botUpdate.currentTripId = new Types.ObjectId(tripId);
    await botUpdate.save();
    return tripId;
  }
}
