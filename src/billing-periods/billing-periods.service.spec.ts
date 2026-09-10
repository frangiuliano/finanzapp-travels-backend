import { Types } from 'mongoose';
import { BillingPeriodsService } from './billing-periods.service';
import { PaymentMethodKind } from '../payment-methods/payment-method.schema';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { InAppNotificationsService } from '../in-app-notifications/in-app-notifications.service';

describe('BillingPeriodsService cycle status', () => {
  const paymentMethodId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const lean = jest.fn();
  const sort = jest.fn(() => ({ lean }));
  const billingPeriodModel = {
    findOne: jest.fn(() => ({ sort })),
  };
  const paymentMethodsService = {
    findOne: jest.fn(),
  };
  const notificationsService = {};

  let service: BillingPeriodsService;

  beforeEach(() => {
    jest.clearAllMocks();
    paymentMethodsService.findOne.mockResolvedValue({
      kind: PaymentMethodKind.CREDIT,
      closingDay: 28,
    });
    service = new BillingPeriodsService(
      billingPeriodModel as never,
      paymentMethodsService as unknown as PaymentMethodsService,
      notificationsService as InAppNotificationsService,
    );
  });

  it('does not report a pending close when a later real close covers the estimate', async () => {
    lean.mockResolvedValue({
      cycleLabel: '2026-10',
      periodFrom: '2026-08-27',
      periodTo: '2026-10-01',
    });

    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    try {
      await expect(
        service.hasUnconfirmedClosedCycle(paymentMethodId, userId),
      ).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a pending close when the latest confirmation ends before it', async () => {
    lean.mockResolvedValue({
      cycleLabel: '2026-08',
      periodFrom: '2026-07-29',
      periodTo: '2026-08-28',
    });

    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    try {
      await expect(
        service.hasUnconfirmedClosedCycle(paymentMethodId, userId),
      ).resolves.toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
