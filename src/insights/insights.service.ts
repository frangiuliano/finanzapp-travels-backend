import { Injectable } from '@nestjs/common';
import { ReportsService } from '../reports/reports.service';
import { ForecastService } from '../forecast/forecast.service';
import {
  buildMonthlyInsightsResponse,
  buildProjectedVariationInsight,
  resolveComparisonPlan,
} from './insights-builder';
import { MonthlyInsightsResponse } from './insights.types';

@Injectable()
export class InsightsService {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly forecastService: ForecastService,
  ) {}

  async getMonthlyInsights(
    boardId: string,
    yearMonth: string,
    userId: string,
  ): Promise<MonthlyInsightsResponse> {
    const plan = resolveComparisonPlan(yearMonth);

    if (plan.monthStatus === 'future') {
      // Still goes through ReportsService for authorization + the board's
      // base currency, and to find out whether this future month already has
      // materialized data (recurring/installments loaded ahead of time) —
      // the app's own default view (current month + 1) is always in this
      // state, so a plain "future month" placeholder there would almost
      // never show anything useful.
      const futureReport = await this.reportsService.getBoardCalendarReport(
        boardId,
        yearMonth,
        userId,
      );

      const hasMaterializedData =
        futureReport.totalExpenses !== 0 || futureReport.totalIncomes !== 0;

      if (!hasMaterializedData) {
        return buildMonthlyInsightsResponse(
          boardId,
          futureReport.currency,
          plan,
          yearMonth,
          null,
          null,
        );
      }

      // Always compare against the immediately preceding month, chaining
      // forward (Nov vs Oct, Dec vs Nov, ...), never always against "today".
      // Only the very first hop — the month right after the real current
      // one — needs a special baseline: the current month's own totals are
      // still partial (it's genuinely in progress), so that one hop compares
      // against its full-month PROJECTION (actual so far + still-planned)
      // instead of its partial actual. Every other future month being
      // compared already has a plain, "complete" (nothing more to accrue by
      // definition) already-loaded total from ReportsService, so no plan
      // computation is needed for those hops.
      const previousYearMonth = plan.previousYearMonth;
      const previousIsRealCurrentMonth =
        previousYearMonth === plan.currentYearMonth;

      let baselineAmount: number;
      if (previousIsRealCurrentMonth) {
        const currentForecast = await this.forecastService.getMonthlyForecast(
          boardId,
          previousYearMonth,
          userId,
        );
        baselineAmount =
          currentForecast.actual.totalExpenses +
          currentForecast.planned.totalOutflows;
      } else {
        const previousReport = await this.reportsService.getBoardCalendarReport(
          boardId,
          previousYearMonth,
          userId,
        );
        baselineAmount = previousReport.totalExpenses;
      }

      const insight = buildProjectedVariationInsight(
        boardId,
        futureReport.currency,
        yearMonth,
        futureReport.totalExpenses,
        previousYearMonth,
        baselineAmount,
      );

      return {
        boardId,
        currency: futureReport.currency,
        currentPeriod: yearMonth,
        previousPeriod: previousYearMonth,
        monthStatus: 'future',
        comparisonMode: 'projected_vs_plan',
        insights: [insight],
      };
    }

    const [currentReport, previousReport] = await Promise.all([
      this.reportsService.getBoardCalendarReport(boardId, yearMonth, userId),
      this.reportsService.getBoardCalendarReport(
        boardId,
        plan.previousYearMonth,
        userId,
        plan.previousUpToDate ? { upToDate: plan.previousUpToDate } : undefined,
      ),
    ]);

    return buildMonthlyInsightsResponse(
      boardId,
      currentReport.currency,
      plan,
      yearMonth,
      currentReport,
      previousReport,
    );
  }
}
