import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserDocument } from '../users/user.schema';
import {
  AdjustHoldingBalanceDto,
  CreateGoalContributionDto,
  CreateHoldingDto,
  CreateSavingsGoalDto,
  UpdateHoldingDto,
  UpdateSavingsGoalDto,
} from './wealth.dto';
import { WealthService } from './wealth.service';

@Controller('wealth')
@UseGuards(JwtAuthGuard)
export class WealthController {
  constructor(private readonly wealthService: WealthService) {}

  @Get()
  getOverview(@GetUser() user: UserDocument) {
    return this.wealthService.getOverview(user._id.toString());
  }

  @Post('holdings')
  createHolding(@Body() dto: CreateHoldingDto, @GetUser() user: UserDocument) {
    return this.wealthService.createHolding(dto, user._id.toString());
  }

  @Patch('holdings/:id')
  updateHolding(
    @Param('id') id: string,
    @Body() dto: UpdateHoldingDto,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updateHolding(id, dto, user._id.toString());
  }

  @Post('holdings/:id/balance-adjustments')
  adjustBalance(
    @Param('id') id: string,
    @Body() dto: AdjustHoldingBalanceDto,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.adjustBalance(id, dto, user._id.toString());
  }

  @Delete('holdings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveHolding(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.wealthService.archiveHolding(id, user._id.toString());
  }

  @Post('goals')
  createGoal(@Body() dto: CreateSavingsGoalDto, @GetUser() user: UserDocument) {
    return this.wealthService.createGoal(dto, user._id.toString());
  }

  @Patch('goals/:id')
  updateGoal(
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updateGoal(id, dto, user._id.toString());
  }

  @Delete('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveGoal(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.wealthService.archiveGoal(id, user._id.toString());
  }

  @Post('goals/:id/contributions')
  contribute(
    @Param('id') id: string,
    @Body() dto: CreateGoalContributionDto,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.contribute(id, dto, user._id.toString());
  }
}
