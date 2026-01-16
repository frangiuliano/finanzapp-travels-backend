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
  ) {
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
    @Query('budgetId') budgetId?: string,
    @Query('status') status?: ExpenseStatus,
  ) {
    if (!tripId) {
      return {
        expenses: [],
      };
    }

    const expenses = await this.expensesService.findAll(
      tripId,
      userId,
      budgetId,
      status,
    );

    return {
      expenses,
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

  @Get('participant/:participantId/balance')
  async getParticipantBalance(
    @Param('participantId') participantId: string,
    @Query('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    if (!tripId) {
      throw new BadRequestException('tripId es requerido');
    }

    const balance = await this.expensesService.getParticipantBalance(
      participantId,
      tripId,
      userId,
    );
    return {
      balance,
    };
  }

  @Get('trip/:tripId/debts')
  async getParticipantDebts(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    const debts = await this.expensesService.getParticipantDebts(
      tripId,
      userId,
    );
    return debts;
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
