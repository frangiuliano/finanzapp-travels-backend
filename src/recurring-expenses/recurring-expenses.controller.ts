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
import { RecurringExpensesService } from './recurring-expenses.service';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('recurring-expenses')
@UseGuards(JwtAuthGuard)
export class RecurringExpensesController {
  constructor(
    private readonly recurringExpensesService: RecurringExpensesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateRecurringExpenseDto,
    @GetUser() user: UserDocument,
  ) {
    const recurringExpense = await this.recurringExpensesService.create(
      createDto,
      user._id.toString(),
    );
    return {
      message: 'Gasto fijo creado exitosamente',
      recurringExpense,
    };
  }

  @Get()
  async findAllByBoard(
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
    @Query('tripId') tripId?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    const recurringExpenses =
      await this.recurringExpensesService.findAllByBoard(
        resolvedBoardId,
        user._id.toString(),
      );
    return { recurringExpenses };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const recurringExpense = await this.recurringExpensesService.findOne(
      id,
      user._id.toString(),
    );
    return { recurringExpense };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateRecurringExpenseDto,
    @GetUser() user: UserDocument,
  ) {
    const recurringExpense = await this.recurringExpensesService.update(
      id,
      updateDto,
      user._id.toString(),
    );
    return {
      message: 'Gasto fijo actualizado exitosamente',
      recurringExpense,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.recurringExpensesService.remove(id, user._id.toString());
  }
}
