import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { BoardsService } from './trips.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { UpdateExpenseLinkDto } from './dto/update-expense-link.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller(['boards', 'trips'])
@UseGuards(JwtAuthGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createBoardDto: CreateBoardDto,
    @GetUser() user: UserDocument,
  ) {
    const board = await this.boardsService.create(
      createBoardDto,
      user._id.toString(),
    );
    return {
      message: 'Tablero creado exitosamente',
      board,
      trip: board,
    };
  }

  @Get()
  async findAll(@GetUser() user: UserDocument) {
    const boards = await this.boardsService.findAll(user._id.toString());
    return {
      boards,
      trips: boards,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const board = await this.boardsService.findOne(id, user._id.toString());
    return {
      board,
      trip: board,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateBoardDto: UpdateBoardDto,
    @GetUser() user: UserDocument,
  ) {
    const board = await this.boardsService.update(
      id,
      updateBoardDto,
      user._id.toString(),
    );
    return {
      message: 'Tablero actualizado exitosamente',
      board,
      trip: board,
    };
  }

  @Patch(':id/expense-link')
  async updateExpenseLink(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseLinkDto,
    @GetUser() user: UserDocument,
  ) {
    const board = await this.boardsService.updateExpenseLink(
      id,
      dto.everydayBoardId ?? null,
      user._id.toString(),
    );
    return {
      message: dto.everydayBoardId
        ? 'Viaje vinculado al tablero cotidiano'
        : 'Viaje desvinculado del tablero cotidiano',
      board,
      trip: board,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.boardsService.remove(id, user._id.toString());
  }
}

/** @deprecated Use BoardsController */
export { BoardsController as TripsController };
