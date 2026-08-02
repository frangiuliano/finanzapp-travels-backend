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
import { IncomesService } from './incomes.service';
import { CreateIncomeDto } from './dto/create-income.dto';
import { UpdateIncomeDto } from './dto/update-income.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('incomes')
@UseGuards(JwtAuthGuard)
export class IncomesController {
  constructor(private readonly incomesService: IncomesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createIncomeDto: CreateIncomeDto,
    @GetUser() user: UserDocument,
  ) {
    const income = await this.incomesService.create(
      createIncomeDto,
      user._id.toString(),
    );
    return {
      message: 'Ingreso creado exitosamente',
      income,
    };
  }

  @Get('summary')
  async getMonthlySummary(
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

    const summary = await this.incomesService.getMonthlySummary(
      resolvedBoardId,
      yearMonth,
      user._id.toString(),
    );

    return { summary };
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

    const incomes = await this.incomesService.findAllByBoard(
      resolvedBoardId,
      user._id.toString(),
    );
    return { incomes };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const income = await this.incomesService.findOne(id, user._id.toString());
    return { income };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateIncomeDto: UpdateIncomeDto,
    @GetUser() user: UserDocument,
  ) {
    const income = await this.incomesService.update(
      id,
      updateIncomeDto,
      user._id.toString(),
    );
    return {
      message: 'Ingreso actualizado exitosamente',
      income,
    };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id') id: string, @GetUser() user: UserDocument) {
    const income = await this.incomesService.confirm(id, user._id.toString());
    return {
      message: 'Ingreso confirmado exitosamente',
      income,
    };
  }

  @Post(':id/skip')
  @HttpCode(HttpStatus.OK)
  async skip(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.incomesService.skip(id, user._id.toString());
    return { message: 'Ingreso omitido para este mes' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.incomesService.remove(id, user._id.toString());
  }
}
