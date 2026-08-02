import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillingPeriod, BillingPeriodDocument } from './billing-period.schema';
import { ConfirmBillingPeriodDto } from './dto/confirm-billing-period.dto';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import {
  PaymentMethodKind,
  PaymentMethodOwnerType,
  PaymentMethod,
} from '../payment-methods/payment-method.schema';
import { InAppNotificationsService } from '../in-app-notifications/in-app-notifications.service';
import { InAppNotificationType } from '../in-app-notifications/in-app-notification.schema';
import {
  getCreditCycleRange,
  isCycleClosed,
  listRecentCycleLabels,
} from '../common/utils/credit-cycle';

export interface BillingPeriodDefaults {
  paymentMethodId: string;
  paymentMethodName: string;
  cycleLabel: string;
  closingDay: number;
  periodFrom: string;
  periodTo: string;
  isConfirmed: boolean;
}

@Injectable()
export class BillingPeriodsService {
  constructor(
    @InjectModel(BillingPeriod.name)
    private billingPeriodModel: Model<BillingPeriodDocument>,
    private paymentMethodsService: PaymentMethodsService,
    @Inject(forwardRef(() => InAppNotificationsService))
    private notificationsService: InAppNotificationsService,
  ) {}

  async findByPaymentMethod(
    paymentMethodId: string,
    userId: string,
  ): Promise<BillingPeriod[]> {
    await this.paymentMethodsService.findOne(paymentMethodId, userId);

    return this.billingPeriodModel
      .find({ paymentMethodId: new Types.ObjectId(paymentMethodId) })
      .sort({ cycleLabel: -1 })
      .lean();
  }

  async findConfirmedPeriod(
    paymentMethodId: string,
    cycleLabel: string,
  ): Promise<BillingPeriod | null> {
    return this.billingPeriodModel
      .findOne({
        paymentMethodId: new Types.ObjectId(paymentMethodId),
        cycleLabel,
      })
      .lean();
  }

  async getPendingConfirmation(
    paymentMethodId: string,
    cycleLabel: string,
    userId: string,
  ): Promise<BillingPeriodDefaults> {
    const method = await this.paymentMethodsService.findOne(
      paymentMethodId,
      userId,
    );

    if (method.kind !== PaymentMethodKind.CREDIT) {
      throw new BadRequestException('Solo aplica a medios de pago de crédito');
    }

    if (method.closingDay == null) {
      throw new BadRequestException(
        'Configurá el día de cierre estimado de la tarjeta primero',
      );
    }

    const confirmed = await this.findConfirmedPeriod(
      paymentMethodId,
      cycleLabel,
    );
    const { from, periodToInclusive } = getCreditCycleRange(
      cycleLabel,
      method.closingDay,
    );

    return {
      paymentMethodId,
      paymentMethodName: method.name,
      cycleLabel,
      closingDay: method.closingDay,
      periodFrom: from,
      periodTo: periodToInclusive,
      isConfirmed: Boolean(confirmed),
    };
  }

  async confirm(
    dto: ConfirmBillingPeriodDto,
    userId: string,
  ): Promise<BillingPeriod> {
    const method = await this.paymentMethodsService.findOne(
      dto.paymentMethodId,
      userId,
    );

    if (method.kind !== PaymentMethodKind.CREDIT) {
      throw new BadRequestException('Solo aplica a medios de pago de crédito');
    }

    if (method.ownerType === PaymentMethodOwnerType.USER) {
      if (method.userId?.toString() !== userId) {
        throw new BadRequestException(
          'No tenés permiso para confirmar este período',
        );
      }
    }

    if (dto.periodFrom > dto.periodTo) {
      throw new BadRequestException(
        'La fecha desde debe ser anterior o igual a la fecha hasta',
      );
    }

    const confirmedAt = new Date();
    const period = await this.billingPeriodModel.findOneAndUpdate(
      {
        paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
        cycleLabel: dto.cycleLabel,
      },
      {
        paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
        userId: new Types.ObjectId(userId),
        cycleLabel: dto.cycleLabel,
        periodFrom: dto.periodFrom,
        periodTo: dto.periodTo,
        confirmedAt,
      },
      { upsert: true, new: true },
    );

    if (!period) {
      throw new NotFoundException('No se pudo guardar el período');
    }

    await this.notificationsService.markBillingPeriodNotificationsRead(
      userId,
      dto.paymentMethodId,
      dto.cycleLabel,
    );

    return period.toObject();
  }

  async syncNotificationsForUser(userId: string): Promise<void> {
    const methods = await this.paymentMethodsService.findByUser(userId);
    const creditMethods = methods.filter(
      (method) =>
        method.kind === PaymentMethodKind.CREDIT && method.closingDay != null,
    );

    const today = new Date();

    for (const method of creditMethods) {
      const paymentMethodId = String(
        (method as PaymentMethod & { _id: Types.ObjectId })._id,
      );
      const closingDay = method.closingDay!;

      const recentCycles = listRecentCycleLabels(closingDay, 6, today);

      for (const cycleLabel of recentCycles) {
        if (!isCycleClosed(cycleLabel, closingDay, today)) {
          continue;
        }

        const existing = await this.findConfirmedPeriod(
          paymentMethodId,
          cycleLabel,
        );
        if (existing) {
          continue;
        }

        const { periodToInclusive } = getCreditCycleRange(
          cycleLabel,
          closingDay,
        );

        await this.notificationsService.createIfNotExists({
          userId,
          type: InAppNotificationType.BILLING_PERIOD_CONFIRMATION,
          title: `Confirmá el cierre de ${method.name}`,
          body: `El período que cierra el ${periodToInclusive} necesita confirmación para reportes precisos.`,
          payload: {
            paymentMethodId,
            cycleLabel,
            paymentMethodName: method.name,
          },
          actionPath: `/billing-periods/confirm?paymentMethodId=${paymentMethodId}&cycleLabel=${cycleLabel}`,
        });

        break;
      }
    }
  }
}
