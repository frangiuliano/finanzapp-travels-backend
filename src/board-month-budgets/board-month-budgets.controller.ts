import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { BoardMonthBudgetsService } from './board-month-budgets.service';
import { CreateBoardMonthBudgetDto } from './dto/create-board-month-budget.dto';
import { UpdateBoardMonthBudgetDto } from './dto/update-board-month-budget.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('board-month-budgets')
@UseGuards(JwtAuthGuard)
export class BoardMonthBudgetsController {
  constructor(
    private readonly boardMonthBudgetsService: BoardMonthBudgetsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateBoardMonthBudgetDto,
    @GetUser() user: UserDocument,
  ) {
    const budget = await this.boardMonthBudgetsService.create(
      createDto,
      user._id.toString(),
    );
    return {
      message: 'Presupuesto mensual creado exitosamente',
      budget,
    };
  }

  @Get('progress')
  async getProgress(
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

    const progress = await this.boardMonthBudgetsService.getProgress(
      resolvedBoardId,
      yearMonth,
      user._id.toString(),
    );

    return { progress };
  }

  @Get()
  async findAllByBoardAndMonth(
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

    const budgets = await this.boardMonthBudgetsService.findAllByBoardAndMonth(
      resolvedBoardId,
      yearMonth,
      user._id.toString(),
    );

    return { budgets };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const budget = await this.boardMonthBudgetsService.findOne(
      id,
      user._id.toString(),
    );
    return { budget };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateBoardMonthBudgetDto,
    @GetUser() user: UserDocument,
  ) {
    const budget = await this.boardMonthBudgetsService.update(
      id,
      updateDto,
      user._id.toString(),
    );
    return {
      message: 'Presupuesto mensual actualizado exitosamente',
      budget,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.boardMonthBudgetsService.remove(id, user._id.toString());
  }
}
