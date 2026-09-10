import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InAppNotificationsService } from './in-app-notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('in-app-notifications')
@UseGuards(JwtAuthGuard)
export class InAppNotificationsController {
  constructor(
    private readonly notificationsService: InAppNotificationsService,
  ) {}

  @Get()
  async findAll(
    @GetUser() user: UserDocument,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const notifications = await this.notificationsService.findForUser(
      user._id.toString(),
      { unreadOnly: unreadOnly === 'true' },
    );

    return { notifications };
  }

  @Get('unread-count')
  async getUnreadCount(@GetUser() user: UserDocument) {
    const count = await this.notificationsService.getUnreadCount(
      user._id.toString(),
    );

    return { count };
  }

  @Patch('read-all')
  async markAllAsRead(@GetUser() user: UserDocument) {
    const result = await this.notificationsService.markAllAsRead(
      user._id.toString(),
    );

    return {
      message: 'Notificaciones marcadas como leídas',
      ...result,
    };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @GetUser() user: UserDocument) {
    const notification = await this.notificationsService.markAsRead(
      id,
      user._id.toString(),
    );

    return {
      message: 'Notificación marcada como leída',
      notification,
    };
  }
}
