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
  AdjustHoldingBalanceDto,
  CreateGoalContributionDto,
  CreateHoldingDto,
  CreateSavingsGoalDto,
  UpdateHoldingDto,
  UpdateSavingsGoalDto,
  CreateInstrumentDto,
  CreateInvestmentTransactionDto,
  CreatePositionDto,
  UpdatePositionPriceDto,
  UpdateInvestmentTransactionDto,
} from './wealth.dto';
import { WealthService } from './wealth.service';

@Controller('wealth')
@UseGuards(JwtAuthGuard)
export class WealthController {
  constructor(private readonly wealthService: WealthService) {}

  @Get()
  getOverview(
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.getOverview(
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('holdings')
  createHolding(
    @Body() dto: CreateHoldingDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.createHolding(
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch('holdings/:id')
  updateHolding(
    @Param('id') id: string,
    @Body() dto: UpdateHoldingDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updateHolding(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('holdings/:id/balance-adjustments')
  adjustBalance(
    @Param('id') id: string,
    @Body() dto: AdjustHoldingBalanceDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.adjustBalance(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Delete('holdings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveHolding(
    @Param('id') id: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    await this.wealthService.archiveHolding(
      id,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('goals')
  createGoal(
    @Body() dto: CreateSavingsGoalDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.createGoal(
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch('goals/:id')
  updateGoal(
    @Param('id') id: string,
    @Body() dto: UpdateSavingsGoalDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updateGoal(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Delete('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archiveGoal(
    @Param('id') id: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    await this.wealthService.archiveGoal(
      id,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('goals/:id/contributions')
  contribute(
    @Param('id') id: string,
    @Body() dto: CreateGoalContributionDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.contribute(
      id,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Get('instruments/catalog')
  async listInstruments(
    @GetUser() user: UserDocument,
    @Query('search') search?: string,
    @Query('currency') currency?: string,
  ) {
    return {
      instruments: await this.wealthService.listInstruments(
        user._id.toString(),
        search,
        currency,
      ),
    };
  }

  @Post('instruments/catalog')
  createInstrument(
    @Body() dto: CreateInstrumentDto,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.createInstrument(dto, user._id.toString());
  }

  @Post('investments/:holdingId/positions')
  createPosition(
    @Param('holdingId') holdingId: string,
    @Body() dto: CreatePositionDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.createPosition(
      holdingId,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch('investments/positions/:positionId/price')
  updatePositionPrice(
    @Param('positionId') positionId: string,
    @Body() dto: UpdatePositionPriceDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updatePositionPrice(
      positionId,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Post('investments/:holdingId/transactions')
  trade(
    @Param('holdingId') holdingId: string,
    @Body() dto: CreateInvestmentTransactionDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.trade(
      holdingId,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Patch('investments/transactions/:transactionId')
  updateTransaction(
    @Param('transactionId') transactionId: string,
    @Body() dto: UpdateInvestmentTransactionDto,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.updateTransaction(
      transactionId,
      dto,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  @Delete('investments/transactions/:transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTransaction(
    @Param('transactionId') transactionId: string,
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
  ) {
    return this.wealthService.deleteTransaction(
      transactionId,
      user._id.toString(),
      this.requireBoardId(boardId),
    );
  }

  private requireBoardId(value?: string) {
    if (!value) throw new BadRequestException('boardId es requerido');
    return value;
  }
}
