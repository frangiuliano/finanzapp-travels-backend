import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ForecastService } from './forecast.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

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
}
