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
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createBudgetDto: CreateBudgetDto,
    @GetUser() user: UserDocument,
  ) {
    const budget = await this.budgetsService.create(
      createBudgetDto,
      user._id.toString(),
    );
    return {
      message: 'Presupuesto creado exitosamente',
      budget,
    };
  }

  @Get()
  async findAllByTrip(
    @Query('tripId') tripId: string,
    @GetUser() user: UserDocument,
  ) {
    if (!tripId) {
      return {
        budgets: [],
      };
    }
    const budgets = await this.budgetsService.findAllByTrip(
      tripId,
      user._id.toString(),
    );
    return {
      budgets,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const budget = await this.budgetsService.findOne(id, user._id.toString());
    return {
      budget,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateBudgetDto: UpdateBudgetDto,
    @GetUser() user: UserDocument,
  ) {
    const budget = await this.budgetsService.update(
      id,
      updateBudgetDto,
      user._id.toString(),
    );
    return {
      message: 'Presupuesto actualizado exitosamente',
      budget,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.budgetsService.remove(id, user._id.toString());
  }
}
