import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BillingPeriodsService } from './billing-periods.service';
import { ConfirmBillingPeriodDto } from './dto/confirm-billing-period.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserDocument } from '../users/user.schema';

@Controller('billing-periods')
@UseGuards(JwtAuthGuard)
export class BillingPeriodsController {
  constructor(private readonly billingPeriodsService: BillingPeriodsService) {}

  @Get()
  async findByPaymentMethod(
    @Query('paymentMethodId') paymentMethodId: string,
    @GetUser() user: UserDocument,
  ) {
    const periods = await this.billingPeriodsService.findByPaymentMethod(
      paymentMethodId,
      user._id.toString(),
    );

    return { periods };
  }

  @Get('pending')
  async getPending(
    @Query('paymentMethodId') paymentMethodId: string,
    @Query('cycleLabel') cycleLabel: string,
    @GetUser() user: UserDocument,
  ) {
    const pending = await this.billingPeriodsService.getPendingConfirmation(
      paymentMethodId,
      cycleLabel,
      user._id.toString(),
    );

    return { pending };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Body() dto: ConfirmBillingPeriodDto,
    @GetUser() user: UserDocument,
  ) {
    const period = await this.billingPeriodsService.confirm(
      dto,
      user._id.toString(),
    );

    return {
      message: 'Período de facturación confirmado',
      period,
    };
  }
}
