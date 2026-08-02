import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { SimulateExpenseDto } from './dto/simulate-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { parseYearMonth } from '../common/utils/parse-year-month';

@Controller('forecast')
@UseGuards(JwtAuthGuard)
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  @Get('monthly')
  async getMonthlyForecast(
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

    const forecast = await this.forecastService.getMonthlyForecast(
      resolvedBoardId,
      yearMonth,
      user._id.toString(),
    );

    return { forecast };
  }

  @Post('simulate-expense')
  async simulateExpense(
    @Body() dto: SimulateExpenseDto,
    @GetUser() user: UserDocument,
  ) {
    const boardId = resolveBoardId(dto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    if (dto.startYearMonth) {
      parseYearMonth(dto.startYearMonth);
    }

    const simulation = await this.forecastService.simulateExpense(
      boardId,
      user._id.toString(),
      {
        label: dto.label,
        totalAmount: dto.totalAmount,
        installments: dto.installments,
        startYearMonth: dto.startYearMonth,
      },
    );

    return { simulation };
  }

  @Post('ensure-horizon')
  async ensureHorizon(
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
    @Query('tripId') tripId?: string,
    @Query('monthsAhead') monthsAhead?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    const parsedMonths = monthsAhead ? Number(monthsAhead) : undefined;

    const result = await this.forecastService.ensureHorizon(
      resolvedBoardId,
      user._id.toString(),
      parsedMonths,
    );

    return { message: 'Horizonte de planificación actualizado', ...result };
  }
}
