import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserDocument } from '../users/user.schema';
import {
  CreateGoalDto,
  PreviewGoalDto,
  UpdateGoalDto,
  UpdateGoalHoldingsDto,
} from './goals.dto';
import { GoalsService } from './goals.service';

@Controller('goals')
@UseGuards(JwtAuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  list(@Query('boardId') boardId: string, @GetUser() user: UserDocument) {
    return this.goalsService.listGoals(
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Get(':id')
  getOne(
    @Param('id') id: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.getGoal(
      id,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Get(':id/progress')
  getProgress(
    @Param('id') id: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.getProgress(
      id,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post()
  create(
    @Body() dto: CreateGoalDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.createGoal(
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('preview')
  preview(
    @Body() dto: PreviewGoalDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.preview(
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGoalDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.updateGoal(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch(':id/holdings')
  updateHoldings(
    @Param('id') id: string,
    @Body() dto: UpdateGoalHoldingsDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.goalsService.updateGoalHoldings(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    await this.goalsService.deleteGoal(
      id,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  private requireBoardId(value?: string) {
    if (!value) throw new BadRequestException('boardId es requerido');
    return value;
  }
}
