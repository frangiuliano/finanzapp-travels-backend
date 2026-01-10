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
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createTripDto: CreateTripDto,
    @GetUser() user: UserDocument,
  ) {
    const trip = await this.tripsService.create(
      createTripDto,
      user._id.toString(),
    );
    return {
      message: 'Viaje creado exitosamente',
      trip,
    };
  }

  @Get()
  async findAll(@GetUser() user: UserDocument) {
    const trips = await this.tripsService.findAll(user._id.toString());
    return {
      trips,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const trip = await this.tripsService.findOne(id, user._id.toString());
    return {
      trip,
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateTripDto: UpdateTripDto,
    @GetUser() user: UserDocument,
  ) {
    const trip = await this.tripsService.update(
      id,
      updateTripDto,
      user._id.toString(),
    );
    return {
      message: 'Viaje actualizado exitosamente',
      trip,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @GetUser() user: UserDocument) {
    await this.tripsService.remove(id, user._id.toString());
  }
}
