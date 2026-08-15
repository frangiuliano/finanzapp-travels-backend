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
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';
import { UpdateBoardVisibilityDto } from './dto/update-board-visibility.dto';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreatePaymentMethodDto,
    @GetUser() user: UserDocument,
  ) {
    const paymentMethod = await this.paymentMethodsService.create(
      createDto,
      user._id.toString(),
    );
    return {
      message: 'Medio de pago creado exitosamente',
      paymentMethod,
    };
  }

  @Get()
  async list(
    @GetUser() user: UserDocument,
    @Query('boardId') boardId?: string,
    @Query('tripId') tripId?: string,
    @Query('scope') scope?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const resolvedBoardId = boardId || tripId;
    const inactive = includeInactive === 'true';

    if (scope === 'user') {
      if (resolvedBoardId) {
        const paymentMethods =
          await this.paymentMethodsService.findUserMethodsForBoard(
            resolvedBoardId,
            user._id.toString(),
            inactive,
          );
        return { paymentMethods };
      }

      const paymentMethods = await this.paymentMethodsService.findByUser(
        user._id.toString(),
        inactive,
      );
      return { paymentMethods };
    }

    if (scope === 'board' && resolvedBoardId) {
      const paymentMethods = await this.paymentMethodsService.findBoardOwned(
        resolvedBoardId,
        user._id.toString(),
        inactive,
      );
      return { paymentMethods };
    }

    if (resolvedBoardId) {
      const paymentMethods =
        await this.paymentMethodsService.findAvailableForBoard(
          resolvedBoardId,
          user._id.toString(),
          inactive,
        );
      return { paymentMethods };
    }

    const paymentMethods = await this.paymentMethodsService.findByUser(
      user._id.toString(),
      inactive,
    );
    return { paymentMethods };
  }

  @Patch(':paymentMethodId/boards/:boardId/visibility')
  async updateBoardVisibility(
    @Param('paymentMethodId') paymentMethodId: string,
    @Param('boardId') boardId: string,
    @Body() dto: UpdateBoardVisibilityDto,
    @GetUser() user: UserDocument,
  ) {
    const visibility = await this.paymentMethodsService.updateBoardVisibility(
      paymentMethodId,
      boardId,
      dto.enabled,
      user._id.toString(),
    );

    return {
      message: dto.enabled
        ? 'Medio de pago habilitado en el tablero'
        : 'Medio de pago ocultado en el tablero',
      visibility,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @GetUser() user: UserDocument) {
    const paymentMethod = await this.paymentMethodsService.findOne(
      id,
      user._id.toString(),
    );
    return { paymentMethod };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePaymentMethodDto,
    @GetUser() user: UserDocument,
  ) {
    const paymentMethod = await this.paymentMethodsService.update(
      id,
      updateDto,
      user._id.toString(),
    );
    return {
      message: 'Medio de pago actualizado exitosamente',
      paymentMethod,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async archive(@Param('id') id: string, @GetUser() user: UserDocument) {
    const paymentMethod = await this.paymentMethodsService.archive(
      id,
      user._id.toString(),
    );
    return {
      message: 'Medio de pago archivado exitosamente',
      paymentMethod,
    };
  }
}
