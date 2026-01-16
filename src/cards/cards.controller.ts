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
import { CardsService } from './cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';

@Controller('cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createCardDto: CreateCardDto,
    @GetUser('_id') userId: string,
  ) {
    const card = await this.cardsService.create(createCardDto, userId);
    return {
      message: 'Tarjeta creada exitosamente',
      card,
    };
  }

  @Get()
  async findAll(@GetUser('_id') userId: string) {
    const cards = await this.cardsService.findByUser(userId);
    return {
      cards,
    };
  }

  @Get('trip/:tripId')
  async findByTrip(
    @Param('tripId') tripId: string,
    @GetUser('_id') userId: string,
  ) {
    const cards = await this.cardsService.findByTrip(tripId, userId);
    return {
      cards,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser('_id') userId: string) {
    const card = await this.cardsService.findOne(id, userId);
    return {
      card,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCardDto: UpdateCardDto,
    @GetUser('_id') userId: string,
  ) {
    const card = await this.cardsService.update(id, updateCardDto, userId);
    return {
      message: 'Tarjeta actualizada exitosamente',
      card,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser('_id') userId: string) {
    await this.cardsService.remove(id, userId);
  }
}
