import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ParticipantsService } from '../participants/participants.service';
import { resolveBoardId } from '../common/utils/resolve-board-id';
import { DEFAULT_CATEGORIES } from './constants/default-categories';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectModel(Category.name)
    private categoryModel: Model<CategoryDocument>,
    private participantsService: ParticipantsService,
  ) {}

  async seedDefaults(boardId: string): Promise<Category[]> {
    const tripId = new Types.ObjectId(boardId);
    const docs = DEFAULT_CATEGORIES.map((seed) => ({
      tripId,
      name: seed.name,
      icon: seed.icon,
      color: seed.color,
      isActive: true,
      isDefault: true,
    }));

    const inserted = await this.categoryModel.insertMany(docs);
    this.logger.log(
      `Seeded ${inserted.length} default categories for board ${boardId}`,
    );
    return inserted;
  }

  async create(
    createCategoryDto: CreateCategoryDto,
    userId: string,
  ): Promise<Category> {
    const boardId = resolveBoardId(createCategoryDto);
    if (!boardId) {
      throw new BadRequestException('boardId o tripId es requerido');
    }

    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const normalizedName = createCategoryDto.name.trim();
    await this.assertNoActiveDuplicateName(
      new Types.ObjectId(boardId),
      normalizedName,
    );

    const category = new this.categoryModel({
      tripId: new Types.ObjectId(boardId),
      name: normalizedName,
      icon: createCategoryDto.icon,
      color: createCategoryDto.color,
      isActive: true,
      isDefault: false,
    });

    return category.save();
  }

  async findAllByBoard(
    boardId: string,
    userId: string,
    includeInactive = false,
  ): Promise<Category[]> {
    await this.participantsService.ensureParticipantAccess(boardId, userId);

    const tripId = new Types.ObjectId(boardId);
    const categoryCount = await this.categoryModel.countDocuments({ tripId });
    if (categoryCount === 0) {
      await this.seedDefaults(boardId);
    }

    const filter: Record<string, unknown> = {
      tripId,
    };

    if (!includeInactive) {
      filter.isActive = true;
    }

    return this.categoryModel
      .find(filter)
      .sort({ isDefault: -1, name: 1 })
      .lean();
  }

  async findOne(id: string, userId: string): Promise<Category> {
    const category = await this.categoryModel.findById(id).lean();

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    await this.participantsService.ensureParticipantAccess(
      category.tripId.toString(),
      userId,
    );

    return category;
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    userId: string,
  ): Promise<Category> {
    const category = await this.categoryModel.findById(id);

    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }

    await this.participantsService.ensureParticipantAccess(
      category.tripId.toString(),
      userId,
    );

    if (updateCategoryDto.name !== undefined) {
      const normalizedName = updateCategoryDto.name.trim();
      await this.assertNoActiveDuplicateName(
        category.tripId,
        normalizedName,
        category._id,
      );
      category.name = normalizedName;
    }

    if (updateCategoryDto.icon !== undefined) {
      category.icon = updateCategoryDto.icon;
    }
    if (updateCategoryDto.color !== undefined) {
      category.color = updateCategoryDto.color;
    }
    if (updateCategoryDto.isActive !== undefined) {
      if (updateCategoryDto.isActive && !category.isActive) {
        await this.assertNoActiveDuplicateName(
          category.tripId,
          category.name,
          category._id,
        );
      }
      category.isActive = updateCategoryDto.isActive;
    }

    return category.save();
  }

  async archive(id: string, userId: string): Promise<Category> {
    return this.update(id, { isActive: false }, userId);
  }

  async deleteByBoard(boardId: string): Promise<void> {
    await this.categoryModel.deleteMany({
      tripId: new Types.ObjectId(boardId),
    });
  }

  private async assertNoActiveDuplicateName(
    tripId: Types.ObjectId,
    name: string,
    excludeId?: Types.ObjectId,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      tripId,
      name: {
        $regex: new RegExp(`^${this.escapeRegex(name.trim())}$`, 'i'),
      },
      isActive: true,
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const duplicate = await this.categoryModel.findOne(filter);

    if (duplicate) {
      throw new BadRequestException(
        'Ya existe una categoría activa con ese nombre en este tablero',
      );
    }
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
