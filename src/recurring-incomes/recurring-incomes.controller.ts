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
import { RecurringIncomesService } from './recurring-incomes.service';
import { CreateRecurringIncomeDto } from './dto/create-recurring-income.dto';
import { UpdateRecurringIncomeDto } from './dto/update-recurring-income.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('recurring-incomes')
@UseGuards(JwtAuthGuard)
export class RecurringIncomesController {
  constructor(
    private readonly recurringIncomesService: RecurringIncomesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateRecurringIncomeDto,
    @GetUser() user: UserDocument,
  ) {
    const recurringIncome = await this.recurringIncomesService.create(
      createDto,
      user._id.toString(),
    );
    return {
      message: 'Ingreso recurrente creado exitosamente',
      recurringIncome,
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

    const recurringIncomes = await this.recurringIncomesService.findAllByBoard(
      resolvedBoardId,
      user._id.toString(),
    );
    return { recurringIncomes };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const recurringIncome = await this.recurringIncomesService.findOne(
      id,
      user._id.toString(),
    );
    return { recurringIncome };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateRecurringIncomeDto,
    @GetUser() user: UserDocument,
  ) {
    const recurringIncome = await this.recurringIncomesService.update(
      id,
      updateDto,
      user._id.toString(),
    );
    return {
      message: 'Ingreso recurrente actualizado exitosamente',
      recurringIncome,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.recurringIncomesService.remove(id, user._id.toString());
  }
}
