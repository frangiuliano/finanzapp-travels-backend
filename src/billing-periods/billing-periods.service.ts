import {
  BadRequestException,
  ForbiddenException,
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
  getNextCycleStart,
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

function addUtcDay(date: string): string {
  return getNextCycleStart(date);
}

function subtractUtcDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function cycleLabelFor(date: string): string {
  return date.slice(0, 7);
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
      periodFrom: confirmed?.periodFrom ?? from,
      periodTo: confirmed?.periodTo ?? periodToInclusive,
      isConfirmed: Boolean(confirmed),
    };
  }

  async getNextPeriod(
    paymentMethodId: string,
    userId: string,
  ): Promise<BillingPeriodDefaults> {
    const method = await this.paymentMethodsService.findOne(
      paymentMethodId,
      userId,
    );
    if (method.kind !== PaymentMethodKind.CREDIT || method.closingDay == null) {
      throw new BadRequestException(
        'Configurá el día de cierre estimado de la tarjeta primero',
      );
    }

    const latest = await this.billingPeriodModel
      .findOne({ paymentMethodId: new Types.ObjectId(paymentMethodId) })
      .sort({ periodTo: -1 })
      .lean();

    const today = new Date();
    const lastClosedLabel = listRecentCycleLabels(
      method.closingDay,
      3,
      today,
    ).find((label) => isCycleClosed(label, method.closingDay!, today));
    if (!lastClosedLabel) {
      throw new BadRequestException('No se pudo estimar el último cierre');
    }
    const currentEstimate = getCreditCycleRange(
      lastClosedLabel,
      method.closingDay,
    );
    const baseClosingDate =
      latest?.periodTo ?? currentEstimate.periodToInclusive;
    const baseDate = new Date(`${baseClosingDate}T00:00:00.000Z`);
    baseDate.setUTCMonth(baseDate.getUTCMonth() + 1);
    const estimatedTo = baseDate.toISOString().slice(0, 10);
    const existing = await this.billingPeriodModel
      .findOne({
        paymentMethodId: new Types.ObjectId(paymentMethodId),
        periodFrom: addUtcDay(baseClosingDate),
      })
      .lean();

    return {
      paymentMethodId,
      paymentMethodName: method.name,
      cycleLabel: existing?.cycleLabel ?? cycleLabelFor(estimatedTo),
      closingDay: method.closingDay,
      periodFrom: existing?.periodFrom ?? addUtcDay(baseClosingDate),
      periodTo: existing?.periodTo ?? estimatedTo,
      isConfirmed: Boolean(existing),
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
        throw new ForbiddenException(
          'No tenés permiso para confirmar este período',
        );
      }
    }

    const current = await this.findConfirmedPeriod(
      dto.paymentMethodId,
      dto.cycleLabel,
    );
    let resolvedPeriodFrom = dto.periodFrom;
    if (current) {
      if (dto.periodFrom > dto.periodTo) {
        throw new BadRequestException(
          'La fecha desde debe ser anterior o igual a la fecha hasta',
        );
      }
      const [previous, next] = await Promise.all([
        this.billingPeriodModel
          .findOne({
            paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
            periodTo: { $lt: current.periodFrom },
          })
          .sort({ periodTo: -1 }),
        this.billingPeriodModel
          .findOne({
            paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
            periodFrom: { $gt: current.periodTo },
          })
          .sort({ periodFrom: 1 }),
      ]);
      const previousTo = subtractUtcDay(dto.periodFrom);
      const nextFrom = addUtcDay(dto.periodTo);
      if (previous && previous.periodFrom > previousTo) {
        throw new BadRequestException(
          'La fecha desde deja al ciclo anterior sin días válidos',
        );
      }
      if (next && nextFrom > next.periodTo) {
        throw new BadRequestException(
          'La fecha hasta deja al ciclo siguiente sin días válidos',
        );
      }
      if (previous) previous.periodTo = previousTo;
      if (next) next.periodFrom = nextFrom;
      await Promise.all([previous?.save(), next?.save()]);
    } else {
      const latest = await this.billingPeriodModel
        .findOne({
          paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
        })
        .sort({ periodTo: -1 })
        .lean();

      if (latest) {
        resolvedPeriodFrom = getNextCycleStart(latest.periodTo);
      } else {
        if (method.closingDay == null) {
          throw new BadRequestException(
            'Configurá el día de cierre estimado de la tarjeta primero',
          );
        }
        const today = new Date();
        const lastClosedLabel = listRecentCycleLabels(
          method.closingDay,
          3,
          today,
        ).find((label) => isCycleClosed(label, method.closingDay!, today));
        if (!lastClosedLabel) {
          throw new BadRequestException('No se pudo estimar el último cierre');
        }
        resolvedPeriodFrom = getNextCycleStart(
          getCreditCycleRange(lastClosedLabel, method.closingDay)
            .periodToInclusive,
        );
      }

      if (resolvedPeriodFrom > dto.periodTo) {
        throw new BadRequestException(
          'La fecha de cierre debe ser posterior al cierre anterior',
        );
      }
      const overlap = await this.billingPeriodModel.findOne({
        paymentMethodId: new Types.ObjectId(dto.paymentMethodId),
        periodFrom: { $lte: dto.periodTo },
        periodTo: { $gte: resolvedPeriodFrom },
      });
      if (overlap) {
        throw new BadRequestException(
          'El período se superpone con otro ciclo de esta tarjeta',
        );
      }
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
        periodFrom: resolvedPeriodFrom,
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
    if (!current) {
      await this.notificationsService.markBillingPeriodNotificationsReadForMethod(
        userId,
        dto.paymentMethodId,
      );
    }

    return period.toObject();
  }

  async syncNotificationsForUser(userId: string): Promise<void> {
    const methods =
      await this.paymentMethodsService.findAccessibleCreditMethods(userId);
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
        const estimated = getCreditCycleRange(cycleLabel, closingDay);
        const closedOn = existing?.periodTo ?? estimated.periodToInclusive;
        const nextFrom = addUtcDay(closedOn);
        const nextExists = await this.billingPeriodModel.exists({
          paymentMethodId: new Types.ObjectId(paymentMethodId),
          periodFrom: nextFrom,
        });
        if (nextExists) break;

        await this.notificationsService.createIfNotExists({
          userId,
          type: InAppNotificationType.BILLING_PERIOD_CONFIRMATION,
          title: `Informá el próximo cierre de ${method.name}`,
          body: `El ciclo cerró el ${closedOn}. Elegí la fecha del próximo cierre para calcular el nuevo período.`,
          payload: {
            paymentMethodId,
            cycleLabel,
            paymentMethodName: method.name,
          },
          actionPath: `/billing-periods/confirm?paymentMethodId=${paymentMethodId}&mode=next`,
        });

        break;
      }
    }
  }
}
