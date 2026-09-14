import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ForbiddenBoardAccessError, ReportsService } from './reports.service';
import { Expense } from '../expenses/expense.schema';
import { Income } from '../incomes/income.schema';
import { Category } from '../categories/category.schema';
import {
  PaymentMethod,
  PaymentMethodKind,
} from '../payment-methods/payment-method.schema';
import { InstallmentPlan } from '../installment-plans/installment-plan.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';

const EMPTY_INSTALLMENT_ACTIVITY = {
  totalAmount: 0,
  count: 0,
  startedPlans: [],
  finishedPlans: [],
};

describe('ReportsService', () => {
  let service: ReportsService;

  const boardId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();
  const categoryId = new Types.ObjectId();
  const paymentMethodId = new Types.ObjectId();

  const expenseModel = { find: jest.fn() };
  const incomeModel = { find: jest.fn() };
  const categoryModel = { find: jest.fn() };
  const paymentMethodModel = { find: jest.fn() };
  const installmentPlanModel = { find: jest.fn() };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
  };

  const boardsService = {
    findByIdOrFail: jest.fn(),
    findAll: jest.fn(),
    findExpenseScopeContext: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: getModelToken(Income.name), useValue: incomeModel },
        { provide: getModelToken(Category.name), useValue: categoryModel },
        {
          provide: getModelToken(PaymentMethod.name),
          useValue: paymentMethodModel,
        },
        {
          provide: getModelToken(InstallmentPlan.name),
          useValue: installmentPlanModel,
        },
        { provide: ParticipantsService, useValue: participantsService },
        { provide: BoardsService, useValue: boardsService },
      ],
    }).compile();

    service = module.get(ReportsService);
    participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      baseCurrency: 'ARS',
      name: 'Hogar',
    });
    boardsService.findExpenseScopeContext.mockResolvedValue([
      {
        board: { _id: boardId, baseCurrency: 'ARS', name: 'Hogar' },
        participantId: new Types.ObjectId(),
      },
    ]);
  });

  describe('getBoardCalendarReport', () => {
    it('should return calendar totals and breakdowns', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ amount: 1000, currency: 'ARS' }]),
      });

      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            amount: 200,
            currency: 'ARS',
            categoryId,
            paymentMethodId,
          },
          {
            amount: 50,
            currency: 'USD',
            categoryId,
            paymentMethodId,
          },
        ]),
      });

      categoryModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ _id: categoryId, name: 'Comida' }]),
      });

      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentMethodId,
            name: 'Visa',
            kind: PaymentMethodKind.CREDIT,
          },
        ]),
      });

      const report = await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(report.totalIncomes).toBe(1000);
      expect(report.totalExpenses).toBe(200);
      expect(report.remaining).toBe(800);
      expect(report.byCategory).toEqual([
        {
          categoryId: categoryId.toString(),
          categoryName: 'Comida',
          total: 200,
          count: 2,
          otherCurrencyTotals: [{ currency: 'USD', total: 50, count: 1 }],
        },
      ]);
      expect(report.byPaymentMethod[0].paymentMethodName).toBe('Visa');
      expect(report.expensesByCurrency).toEqual([
        { currency: 'USD', total: 50, count: 1 },
      ]);
    });

    it('should keep cross-currency expenses discriminated instead of converting them into the total', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            amount: 200,
            currency: 'ARS',
            categoryId,
            paymentMethodId,
          },
          {
            amount: 10,
            currency: 'USD',
            fxRateToBoardCurrency: 100,
            categoryId,
            paymentMethodId,
          },
        ]),
      });

      categoryModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ _id: categoryId, name: 'Comida' }]),
      });

      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentMethodId,
            name: 'Visa',
            kind: PaymentMethodKind.CREDIT,
          },
        ]),
      });

      const report = await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(report.totalExpenses).toBe(200);
      expect(report.expensesByCurrency).toEqual([
        { currency: 'USD', total: 10, count: 1 },
      ]);
    });

    it('should report a finished plan (installmentNumber === totalInstallments) and a started one (=== paidInstallments + 1)', async () => {
      const finishedPlanId = new Types.ObjectId();
      const startedPlanId = new Types.ObjectId();

      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            amount: 1000,
            currency: 'ARS',
            installmentPlanId: finishedPlanId,
            installmentNumber: 12,
          },
          {
            amount: 500,
            currency: 'ARS',
            installmentPlanId: startedPlanId,
            installmentNumber: 3, // plan seeded with paidInstallments=2
          },
        ]),
      });
      categoryModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      installmentPlanModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: finishedPlanId,
            label: 'Heladera',
            totalInstallments: 12,
            paidInstallments: 0,
          },
          {
            _id: startedPlanId,
            label: 'Notebook',
            totalInstallments: 6,
            paidInstallments: 2,
          },
        ]),
      });

      const report = await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(report.installmentActivity.totalAmount).toBe(1500);
      expect(report.installmentActivity.count).toBe(2);
      expect(report.installmentActivity.finishedPlans).toEqual([
        expect.objectContaining({
          label: 'Heladera',
          installmentNumber: 12,
          totalInstallments: 12,
        }),
      ]);
      expect(report.installmentActivity.startedPlans).toEqual([
        expect.objectContaining({
          label: 'Notebook',
          installmentNumber: 3,
          totalInstallments: 6,
        }),
      ]);
    });

    it('should return empty installment activity without querying InstallmentPlan when no expense is installment-linked', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ amount: 100, currency: 'ARS', categoryId }]),
      });
      categoryModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const report = await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
      );

      expect(report.installmentActivity).toEqual(EMPTY_INSTALLMENT_ACTIVITY);
      expect(installmentPlanModel.find).not.toHaveBeenCalled();
    });

    it('should require participant access', async () => {
      participantsService.ensureParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        service.getBoardCalendarReport(boardId.toString(), '2026-07', userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should filter expenses/incomes by expenseDate/incomeDate cutoff when upToDate is given', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ amount: 1000, currency: 'ARS' }]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { amount: 200, currency: 'ARS', categoryId, paymentMethodId },
          ]),
      });
      categoryModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ _id: categoryId, name: 'Comida' }]),
      });
      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: paymentMethodId,
            name: 'Visa',
            kind: PaymentMethodKind.CREDIT,
          },
        ]),
      });

      const cutoff = new Date(2026, 6, 15, 23, 59, 59, 999);
      await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
        {
          upToDate: cutoff,
        },
      );

      const [expenseQueryArg] = expenseModel.find.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(expenseQueryArg).toMatchObject({
        tripId: expect.anything(),
        paymentYearMonth: '2026-07',
        expenseDate: { $lte: cutoff },
      });

      const [incomeQueryArg] = incomeModel.find.mock.calls[0] as [
        { incomeDate: { $lt: Date } },
      ];
      expect(incomeQueryArg.incomeDate.$lt).toEqual(cutoff);
    });

    it('should not narrow the income upper bound past the month end when upToDate is later', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      categoryModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const farFutureCutoff = new Date(2099, 0, 1);
      await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
        {
          upToDate: farFutureCutoff,
        },
      );

      const [incomeQueryArg] = incomeModel.find.mock.calls[0] as [
        { incomeDate: { $lt: Date } },
      ];
      expect(incomeQueryArg.incomeDate.$lt).toEqual(new Date('2026-08-01'));
    });

    it('should behave exactly as before when no options are passed', async () => {
      incomeModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      categoryModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      paymentMethodModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.getBoardCalendarReport(
        boardId.toString(),
        '2026-07',
        userId,
      );

      const [expenseQueryArg] = expenseModel.find.mock.calls[0] as [
        { expenseDate?: unknown },
      ];
      expect(expenseQueryArg.expenseDate).toBeUndefined();
    });
  });

  describe('getConsolidatedReport', () => {
    const board2Id = new Types.ObjectId();

    beforeEach(() => {
      boardsService.findAll.mockResolvedValue([
        { _id: boardId, name: 'Hogar', baseCurrency: 'ARS' },
        { _id: board2Id, name: 'Viaje', baseCurrency: 'USD' },
      ]);
    });

    it('should aggregate all user boards by currency', async () => {
      jest
        .spyOn(service, 'getBoardCalendarReport')
        .mockResolvedValueOnce({
          boardId: boardId.toString(),
          yearMonth: '2026-07',
          currency: 'ARS',
          totalIncomes: 1000,
          totalExpenses: 400,
          remaining: 600,
          byCategory: [],
          byPaymentMethod: [],
          incomesByCurrency: [],
          expensesByCurrency: [],
          installmentActivity: EMPTY_INSTALLMENT_ACTIVITY,
        })
        .mockResolvedValueOnce({
          boardId: board2Id.toString(),
          yearMonth: '2026-07',
          currency: 'USD',
          totalIncomes: 500,
          totalExpenses: 100,
          remaining: 400,
          byCategory: [],
          byPaymentMethod: [],
          incomesByCurrency: [],
          expensesByCurrency: [],
          installmentActivity: EMPTY_INSTALLMENT_ACTIVITY,
        });

      const report = await service.getConsolidatedReport('2026-07', userId);

      expect(report.boards).toHaveLength(2);
      expect(report.totalsByCurrency.ARS).toEqual({
        totalIncomes: 1000,
        totalExpenses: 400,
        remaining: 600,
        boardCount: 1,
      });
      expect(report.totalsByCurrency.USD.boardCount).toBe(1);
    });

    it('should reject boardIds the user cannot access', async () => {
      await expect(
        service.getConsolidatedReport('2026-07', userId, [
          new Types.ObjectId().toString(),
        ]),
      ).rejects.toBeInstanceOf(ForbiddenBoardAccessError);
    });

    it('should deduplicate repeated boardIds in consolidated report', async () => {
      const calendarSpy = jest
        .spyOn(service, 'getBoardCalendarReport')
        .mockResolvedValue({
          boardId: boardId.toString(),
          yearMonth: '2026-07',
          currency: 'ARS',
          totalIncomes: 1000,
          totalExpenses: 400,
          remaining: 600,
          byCategory: [],
          byPaymentMethod: [],
          incomesByCurrency: [],
          expensesByCurrency: [],
          installmentActivity: EMPTY_INSTALLMENT_ACTIVITY,
        });

      const report = await service.getConsolidatedReport('2026-07', userId, [
        boardId.toString(),
        boardId.toString(),
      ]);

      expect(calendarSpy).toHaveBeenCalledTimes(1);
      expect(report.boards).toHaveLength(1);
      expect(report.totalsByCurrency.ARS.boardCount).toBe(1);
    });
  });
});
