import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InsightsService } from './insights.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';
import { parseYearMonth } from '../common/utils/parse-year-month';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Get('insights')
  async getMonthlyInsights(
    @Query('boardId') boardId: string,
    @Query('yearMonth') yearMonth: string,
    @GetUser() user: UserDocument,
  ) {
    if (!boardId) {
      throw new BadRequestException('boardId es requerido');
    }
    if (!yearMonth) {
      throw new BadRequestException('yearMonth es requerido (formato YYYY-MM)');
    }
    parseYearMonth(yearMonth);

    const insights = await this.insightsService.getMonthlyInsights(
      boardId,
      yearMonth,
      user._id.toString(),
    );

    return { insights };
  }
}
