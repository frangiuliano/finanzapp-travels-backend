import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InAppNotification,
  InAppNotificationDocument,
  InAppNotificationType,
} from './in-app-notification.schema';

export interface CreateInAppNotificationInput {
  userId: string;
  type: InAppNotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  actionPath?: string;
}

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

  async createIfNotExists(
    input: CreateInAppNotificationInput,
  ): Promise<InAppNotification | null> {
    const userId = new Types.ObjectId(input.userId);

    if (
      input.payload?.paymentMethodId &&
      input.payload?.cycleLabel &&
      input.type === InAppNotificationType.BILLING_PERIOD_CONFIRMATION
    ) {
      const existing = await this.notificationModel.findOne({
        userId,
        type: input.type,
        'payload.paymentMethodId': input.payload.paymentMethodId,
        'payload.cycleLabel': input.payload.cycleLabel,
      });

      if (existing) {
        return existing.toObject();
      }
    }

    try {
      const created = await this.notificationModel.create({
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: input.payload,
        actionPath: input.actionPath,
        readAt: null,
      });
      return created.toObject();
    } catch {
      const existing = await this.notificationModel.findOne({
        userId,
        type: input.type,
        'payload.paymentMethodId': input.payload?.paymentMethodId,
        'payload.cycleLabel': input.payload?.cycleLabel,
      });
      return existing?.toObject() ?? null;
    }
  }

  async markBillingPeriodNotificationsRead(
    userId: string,
    paymentMethodId: string,
    cycleLabel: string,
  ): Promise<void> {
    await this.notificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        type: InAppNotificationType.BILLING_PERIOD_CONFIRMATION,
        'payload.paymentMethodId': paymentMethodId,
        'payload.cycleLabel': cycleLabel,
        readAt: null,
      },
      { readAt: new Date() },
    );
  }

  async markBillingPeriodNotificationsReadForMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<void> {
    await this.notificationModel.updateMany(
      {
        userId: new Types.ObjectId(userId),
        type: InAppNotificationType.BILLING_PERIOD_CONFIRMATION,
        'payload.paymentMethodId': paymentMethodId,
        readAt: null,
      },
      { readAt: new Date() },
    );
  }
}
