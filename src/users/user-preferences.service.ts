import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './user.schema';
import { BoardsService } from '../trips/trips.service';
import { Board } from '../trips/board.schema';

@Injectable()
export class UserPreferencesService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private boardsService: BoardsService,
  ) {}

  async getActiveBoardId(userId: string): Promise<string | null> {
    const user = await this.userModel.findById(userId).select('activeBoardId');
    if (!user?.activeBoardId) {
      return null;
    }
    return user.activeBoardId.toString();
  }

  async setActiveBoardId(
    userId: string,
    boardId: string | null,
  ): Promise<string | null> {
    if (boardId === null) {
      await this.userModel.findByIdAndUpdate(userId, {
        $set: { activeBoardId: null },
      });
      return null;
    }

    await this.boardsService.findOne(boardId, userId);

    await this.userModel.findByIdAndUpdate(userId, {
      $set: { activeBoardId: new Types.ObjectId(boardId) },
    });

    return boardId;
  }

  async resolveActiveBoard(userId: string): Promise<Board | null> {
    const activeBoardId = await this.getActiveBoardId(userId);
    if (!activeBoardId) {
      return null;
    }

    try {
      return await this.boardsService.findOne(activeBoardId, userId);
    } catch {
      await this.setActiveBoardId(userId, null);
      return null;
    }
  }

  async requireUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  async updatePreferences(
    userId: string,
    activeBoardId?: string | null,
  ): Promise<{ activeBoardId: string | null }> {
    if (activeBoardId === undefined) {
      throw new BadRequestException('No hay preferencias para actualizar');
    }

    const resolved = await this.setActiveBoardId(userId, activeBoardId);
    return { activeBoardId: resolved };
  }
}
