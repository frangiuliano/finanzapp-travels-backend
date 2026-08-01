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
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ExpenseStatus } from './expense.schema';

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createExpenseDto: CreateExpenseDto,
    @GetUser('_id') userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey && !createExpenseDto.clientRequestId) {
      createExpenseDto.clientRequestId = idempotencyKey;
    }

    const expense = await this.expensesService.create(createExpenseDto, userId);
    return {
      message: 'Gasto creado exitosamente',
      expense,
    };
  }

  @Get()
  async findAll(
    @Query('tripId') tripId: string,
    @GetUser('_id') userId: string,
    @Query('boardId') boardId?: string,
    @Query('budgetId') budgetId?: string,
    @Query('status') status?: ExpenseStatus,
    @Query('categoryId') categoryId?: string,
    @Query('paymentMethodId') paymentMethodId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      return {
        expenses: [],
      };
    }

    const expenses = await this.expensesService.findAll(
      resolvedBoardId,
      userId,
      {
        budgetId,
        status,
        categoryId,
        paymentMethodId,
        from,
        to,
      },
    );

    return {
      expenses,
    };
  }

  @Get('trip/:tripId/summary')
  async getTripExpenseSummary(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    const summary = await this.expensesService.getTripExpenseSummary(
      tripId,
      userId,
    );
    return {
      summary,
    };
  }

  @Get('board/:boardId/summary')
  async getBoardExpenseSummary(
    @Param('boardId') boardId: string,
    @GetUser('_id') userId: string,
  ) {
    const summary = await this.expensesService.getTripExpenseSummary(
      boardId,
      userId,
    );
    return {
      summary,
    };
  }

  @Get('trip/:tripId/debts')
  async getParticipantDebts(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.expensesService.getParticipantDebts(tripId, userId);
  }

  @Get('board/:boardId/debts')
  async getBoardParticipantDebts(
    @Param('boardId') boardId: string,
    @GetUser('_id') userId: string,
  ) {
    return this.expensesService.getParticipantDebts(boardId, userId);
  }

  @Get('participant/:participantId/balance')
  async getParticipantBalance(
    @Param('participantId') participantId: string,
    @Query('tripId') tripId: string,
    @GetUser('_id') userId: string,
    @Query('boardId') boardId?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    const balance = await this.expensesService.getParticipantBalance(
      participantId,
      resolvedBoardId,
      userId,
    );
    return {
      balance,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser('_id') userId: string) {
    const expense = await this.expensesService.findOne(id, userId);
    return {
      expense,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateExpenseDto: UpdateExpenseDto,
    @GetUser('_id') userId: string,
  ) {
    const expense = await this.expensesService.update(
      id,
      updateExpenseDto,
      userId,
    );
    return {
      message: 'Gasto actualizado exitosamente',
      expense,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser('_id') userId: string) {
    await this.expensesService.remove(id, userId);
  }

  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  async settleExpense(@Param('id') id: string, @GetUser('_id') userId: string) {
    const expense = await this.expensesService.settleExpense(id, userId);
    return {
      message: 'Gasto marcado como saldado exitosamente',
      expense,
    };
  }
}
