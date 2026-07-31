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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @GetUser() user: UserDocument,
  ) {
    const category = await this.categoriesService.create(
      createCategoryDto,
      user._id.toString(),
    );
    return {
      message: 'Categoría creada exitosamente',
      category,
    };
  }

  @Get()
  async findAllByBoard(
    @Query('boardId') boardId: string,
    @GetUser() user: UserDocument,
    @Query('tripId') tripId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    if (!resolvedBoardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    const categories = await this.categoriesService.findAllByBoard(
      resolvedBoardId,
      user._id.toString(),
      includeInactive === 'true',
    );
    return { categories };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const category = await this.categoriesService.findOne(
      id,
      user._id.toString(),
    );
    return { category };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @GetUser() user: UserDocument,
  ) {
    const category = await this.categoriesService.update(
      id,
      updateCategoryDto,
      user._id.toString(),
    );
    return {
      message: 'Categoría actualizada exitosamente',
      category,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async archive(@Param('id') id: string, @GetUser() user: UserDocument) {
    const category = await this.categoriesService.archive(
      id,
      user._id.toString(),
    );
    return {
      message: 'Categoría archivada exitosamente',
      category,
    };
  }
}
