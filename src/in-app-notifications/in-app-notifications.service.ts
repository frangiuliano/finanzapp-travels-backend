import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InAppNotification,
  InAppNotificationDocument,
} from './in-app-notification.schema';

@Injectable()
export class InAppNotificationsService {
  constructor(
    @InjectModel(InAppNotification.name)
    private notificationModel: Model<InAppNotificationDocument>,
  ) {}

  async findForUser(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number },
  ): Promise<InAppNotification[]> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    if (options?.unreadOnly) {
      filter.readAt = null;
    }

    return this.notificationModel
      .find(filter)
      .sort({ readAt: 1, createdAt: -1 })
      .limit(options?.limit ?? 50)
      .lean();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    });
  }

  async markAsRead(id: string, userId: string): Promise<InAppNotification> {
    const notification = await this.notificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      },
      { readAt: new Date() },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }

    return notification.toObject();
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        readAt: null,
      },
      { readAt: new Date() },
    );

    return { updated: result.modifiedCount };
  }
}
