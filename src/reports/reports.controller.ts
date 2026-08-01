import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('board')
  async getBoardCalendarReport(
    @Query('boardId') boardId: string,
    @Query('yearMonth') yearMonth: string,
    @GetUser() user: UserDocument,
    @Query('tripId') tripId?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }
    if (!yearMonth) {
      throw new BadRequestException('yearMonth es requerido (formato YYYY-MM)');
    }

    const report = await this.reportsService.getBoardCalendarReport(
      resolvedBoardId,
      yearMonth,
      user._id.toString(),
    );

    return { report };
  }

  @Get('board/credit-cycle')
  async getCreditCycleReport(
    @Query('boardId') boardId: string,
    @Query('paymentMethodId') paymentMethodId: string,
    @GetUser() user: UserDocument,
    @Query('cycle') cycle = 'current',
    @Query('tripId') tripId?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }
    if (!paymentMethodId) {
      throw new BadRequestException('paymentMethodId es requerido');
    }

    const report = await this.reportsService.getCreditCycleReport(
      resolvedBoardId,
      paymentMethodId,
      cycle,
      user._id.toString(),
    );

    return { report };
  }

  @Get('consolidated')
  async getConsolidatedReport(
    @Query('yearMonth') yearMonth: string,
    @GetUser() user: UserDocument,
    @Query('boardIds') boardIdsParam?: string,
  ) {
    if (!yearMonth) {
      throw new BadRequestException('yearMonth es requerido (formato YYYY-MM)');
    }

    const boardIds = boardIdsParam
      ? boardIdsParam
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

    const report = await this.reportsService.getConsolidatedReport(
      yearMonth,
      user._id.toString(),
      boardIds,
    );

    return { report };
  }
}
