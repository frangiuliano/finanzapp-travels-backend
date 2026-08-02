import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ForbiddenBoardAccessError, ReportsService } from './reports.service';
import { Expense } from '../expenses/expense.schema';
import { Income } from '../incomes/income.schema';
import { Category } from '../categories/category.schema';
import {
  PaymentMethod,
  PaymentMethodKind,
} from '../payment-methods/payment-method.schema';
import { ParticipantsService } from '../participants/participants.service';
import { BoardsService } from '../trips/trips.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { BillingPeriodsService } from '../billing-periods/billing-periods.service';

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

  const paymentMethodsService = {
    findAvailableForBoard: jest.fn(),
  };

  const participantsService = {
    ensureParticipantAccess: jest.fn(),
  };

  const boardsService = {
    findByIdOrFail: jest.fn(),
    findAll: jest.fn(),
  };

  const billingPeriodsService = {
    findConfirmedPeriod: jest.fn().mockResolvedValue(null),
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
        { provide: ParticipantsService, useValue: participantsService },
        { provide: BoardsService, useValue: boardsService },
        { provide: PaymentMethodsService, useValue: paymentMethodsService },
        { provide: BillingPeriodsService, useValue: billingPeriodsService },
      ],
    }).compile();

    service = module.get(ReportsService);
    participantsService.ensureParticipantAccess.mockResolvedValue(undefined);
    boardsService.findByIdOrFail.mockResolvedValue({
      _id: boardId,
      baseCurrency: 'ARS',
      name: 'Hogar',
    });
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
          count: 1,
        },
      ]);
      expect(report.byPaymentMethod[0].paymentMethodName).toBe('Visa');
      expect(report.excludedDueToCurrencyMismatch).toEqual({
        incomes: 0,
        expenses: 1,
      });
    });

    it('should include cross-currency expenses with FX snapshot in totals', async () => {
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

      expect(report.totalExpenses).toBe(1200);
      expect(report.excludedDueToCurrencyMismatch.expenses).toBe(0);
    });

    it('should require participant access', async () => {
      participantsService.ensureParticipantAccess.mockRejectedValue(
        new ForbiddenException('No tienes acceso'),
      );

      await expect(
        service.getBoardCalendarReport(boardId.toString(), '2026-07', userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getCreditCycleReport', () => {
    it('should return closing_day_required when credit card has no closingDay', async () => {
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([
        {
          _id: paymentMethodId,
          name: 'Visa',
          kind: PaymentMethodKind.CREDIT,
          closingDay: undefined,
        },
      ]);

      const report = await service.getCreditCycleReport(
        boardId.toString(),
        paymentMethodId.toString(),
        'current',
        userId,
      );

      expect(report).toEqual({
        status: 'closing_day_required',
        boardId: boardId.toString(),
        paymentMethodId: paymentMethodId.toString(),
        paymentMethodName: 'Visa',
        message:
          'Configura el día de cierre de esta tarjeta para ver reportes por ciclo de facturación',
      });
    });

    it('should return credit cycle totals for configured card', async () => {
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([
        {
          _id: paymentMethodId,
          name: 'Visa',
          kind: PaymentMethodKind.CREDIT,
          closingDay: 14,
        },
      ]);

      expenseModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            amount: 300,
            currency: 'ARS',
            expenseDate: new Date('2026-08-01T00:00:00.000Z'),
          },
        ]),
      });

      const report = await service.getCreditCycleReport(
        boardId.toString(),
        paymentMethodId.toString(),
        '2026-08',
        userId,
      );

      expect(report.status).toBe('ok');
      if (report.status === 'ok') {
        expect(report.totalExpenses).toBe(300);
        expect(report.periodFrom).toBe('2026-07-15');
        expect(report.periodToInclusive).toBe('2026-08-14');
        expect(report.availableCycles).toHaveLength(12);
      }
    });

    it('should reject non-credit payment methods', async () => {
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([
        {
          _id: paymentMethodId,
          name: 'Efectivo',
          kind: PaymentMethodKind.CASH,
          closingDay: 14,
        },
      ]);

      await expect(
        service.getCreditCycleReport(
          boardId.toString(),
          paymentMethodId.toString(),
          'current',
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should reject payment methods not available for the board', async () => {
      paymentMethodsService.findAvailableForBoard.mockResolvedValue([]);

      await expect(
        service.getCreditCycleReport(
          boardId.toString(),
          paymentMethodId.toString(),
          'current',
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
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
          excludedDueToCurrencyMismatch: { incomes: 0, expenses: 0 },
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
          excludedDueToCurrencyMismatch: { incomes: 0, expenses: 0 },
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
          excludedDueToCurrencyMismatch: { incomes: 0, expenses: 0 },
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
