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
import { InstallmentPlansService } from './installment-plans.service';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('installment-plans')
@UseGuards(JwtAuthGuard)
export class InstallmentPlansController {
  constructor(
    private readonly installmentPlansService: InstallmentPlansService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreateInstallmentPlanDto,
    @GetUser() user: UserDocument,
  ) {
    const installmentPlan = await this.installmentPlansService.create(
      createDto,
      user._id.toString(),
    );
    return {
      message: 'Plan de cuotas creado exitosamente',
      installmentPlan,
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

    const installmentPlans = await this.installmentPlansService.findAllByBoard(
      resolvedBoardId,
      user._id.toString(),
    );
    return { installmentPlans };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const installmentPlan = await this.installmentPlansService.findOne(
      id,
      user._id.toString(),
    );
    return { installmentPlan };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateInstallmentPlanDto,
    @GetUser() user: UserDocument,
  ) {
    const installmentPlan = await this.installmentPlansService.update(
      id,
      updateDto,
      user._id.toString(),
    );
    return {
      message: 'Plan de cuotas actualizado exitosamente',
      installmentPlan,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.installmentPlansService.remove(id, user._id.toString());
  }
}
