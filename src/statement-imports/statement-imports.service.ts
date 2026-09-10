import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  StatementImportSession,
  StatementImportSessionDocument,
  StatementImportLine,
} from './statement-import-session.schema';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { ExpensesService } from '../expenses/expenses.service';
import {
  PaymentMethod,
  PaymentMethodKind,
} from '../payment-methods/payment-method.schema';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { extractStatementText } from './parsing/statement-text-extractor';
import {
  ParsedStatementLine,
  StatementLineSource,
  parseStatementText,
} from './parsing/generic-statement-parser';
import { StatementLlmFallbackService } from './parsing/statement-llm-fallback.service';
import { matchStatementLines } from './parsing/duplicate-matcher';
import { ConfirmStatementImportDto } from './dto/confirm-statement-import.dto';
import { toSafeErrorMessage } from '../common/utils/log-redaction.util';

const LLM_FALLBACK_CONFIDENCE_THRESHOLD = 0.5;
const DUPLICATE_LOOKUP_WINDOW_DAYS = 3;

export interface StatementImportStats {
  totalLines: number;
  possibleDuplicates: number;
  lowConfidenceDocument: boolean;
}

@Injectable()
export class StatementImportsService {
  private readonly logger = new Logger(StatementImportsService.name);

  constructor(
    @InjectModel(StatementImportSession.name)
    private sessionModel: Model<StatementImportSessionDocument>,
    @InjectModel(Expense.name)
    private expenseModel: Model<ExpenseDocument>,
    private paymentMethodsService: PaymentMethodsService,
    private expensesService: ExpensesService,
    private llmFallback: StatementLlmFallbackService,
  ) {}

  async processUpload(
    fileBuffer: Buffer,
    boardId: string,
    paymentMethodId: string,
    userId: string,
  ): Promise<{
    importId: string;
    lines: StatementImportLine[];
    stats: StatementImportStats;
    periodFrom: string;
    periodTo: string;
  }> {
    const availableMethods =
      await this.paymentMethodsService.findAvailableForBoard(boardId, userId);
    const method = availableMethods.find(
      (m) =>
        (m as PaymentMethod & { _id: Types.ObjectId })._id.toString() ===
        paymentMethodId,
    );
    if (!method) {
      throw new ForbiddenException(
        'La tarjeta indicada no está disponible para este tablero',
      );
    }
    if (method.kind !== PaymentMethodKind.CREDIT) {
      throw new BadRequestException(
        'Solo se pueden importar resúmenes de tarjetas de crédito',
      );
    }

    const text = await extractStatementText(fileBuffer);
    const parsed = parseStatementText(text);

    const resolvedLines: ParsedStatementLine[] = [];
    for (const line of parsed.lines) {
      if (
        line.confidence < LLM_FALLBACK_CONFIDENCE_THRESHOLD &&
        this.llmFallback.isEnabled()
      ) {
        resolvedLines.push(await this.llmFallback.resolveLine(line));
      } else {
        resolvedLines.push(line);
      }
    }

    const { periodFrom, periodTo } = this.computePeriodRange(resolvedLines);

    const linesWithDuplicates = await this.markPossibleDuplicates(
      resolvedLines,
      boardId,
      paymentMethodId,
      periodFrom,
      periodTo,
    );

    const session = await this.sessionModel.create({
      userId: new Types.ObjectId(userId),
      boardId: new Types.ObjectId(boardId),
      paymentMethodId: new Types.ObjectId(paymentMethodId),
      lines: linesWithDuplicates,
      lowConfidenceDocument: parsed.lowConfidenceDocument,
      periodFrom,
      periodTo,
    });

    return {
      importId: session._id.toString(),
      lines: session.lines,
      stats: {
        totalLines: session.lines.length,
        possibleDuplicates: session.lines.filter((l) => l.isPossibleDuplicate)
          .length,
        lowConfidenceDocument: session.lowConfidenceDocument,
      },
      periodFrom: session.periodFrom,
      periodTo: session.periodTo,
    };
  }

  /**
   * The parsed statement's own date range, padded by a few days on each
   * side so duplicate-detection doesn't miss lines just outside it (there's
   * no more card billing cycle to widen against — dates are informational).
   */
  private computePeriodRange(lines: ParsedStatementLine[]): {
    periodFrom: string;
    periodTo: string;
  } {
    const PADDING_DAYS = 3;
    if (lines.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      return { periodFrom: today, periodTo: today };
    }

    const dates = lines.map((line) => line.date).sort();
    const parsedMinDate = dates[0];
    const parsedMaxDate = dates[dates.length - 1];

    const padDate = (dateStr: string, deltaDays: number): string => {
      const date = new Date(`${dateStr}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + deltaDays);
      return date.toISOString().slice(0, 10);
    };

    return {
      periodFrom: padDate(parsedMinDate, -PADDING_DAYS),
      periodTo: padDate(parsedMaxDate, PADDING_DAYS),
    };
  }

  async getSession(
    importId: string,
    userId: string,
  ): Promise<StatementImportSessionDocument> {
    const session = await this.sessionModel.findById(importId);
    if (!session || session.userId.toString() !== userId) {
      throw new NotFoundException('Importación no encontrada o expirada');
    }
    return session;
  }

  async cancel(importId: string, userId: string): Promise<void> {
    const session = await this.getSession(importId, userId);
    await session.deleteOne();
  }

  async confirm(
    importId: string,
    userId: string,
    dto: ConfirmStatementImportDto,
  ): Promise<{
    created: number;
    failed: { tempId: string; message: string }[];
  }> {
    const session = await this.getSession(importId, userId);
    const linesByTempId = new Map(
      session.lines.map((line) => [line.tempId, line]),
    );

    const failed: { tempId: string; message: string }[] = [];
    let created = 0;

    const included = dto.selections.filter((selection) => selection.include);

    const results = await Promise.allSettled(
      included.map(async (selection) => {
        const line = linesByTempId.get(selection.tempId);
        if (!line) {
          throw new BadRequestException(
            `La línea ${selection.tempId} no pertenece a esta importación`,
          );
        }
        const overrides = selection.overrides ?? {};
        await this.expensesService.create(
          {
            boardId: session.boardId.toString(),
            paymentMethodId: session.paymentMethodId.toString(),
            amount: overrides.amount ?? line.amount,
            currency: line.currency,
            description: overrides.description ?? line.description,
            merchantName: overrides.merchantName,
            categoryId: overrides.categoryId,
            expenseDate: overrides.expenseDate ?? line.date,
            paymentYearMonth: (overrides.expenseDate ?? line.date).slice(0, 7),
            clientRequestId: selection.tempId,
          },
          userId,
        );
      }),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        created += 1;
      } else {
        const tempId = included[index].tempId;
        const message = toSafeErrorMessage(result.reason);
        this.logger.warn(
          `No se pudo crear el gasto de la línea ${tempId}: ${message}`,
        );
        failed.push({ tempId, message });
      }
    });

    await session.deleteOne();

    return { created, failed };
  }

  private async markPossibleDuplicates(
    lines: ParsedStatementLine[],
    boardId: string,
    paymentMethodId: string,
    periodFrom: string,
    periodTo: string,
  ): Promise<StatementImportLine[]> {
    if (lines.length === 0) return [];

    const minDate = new Date(
      new Date(`${periodFrom}T00:00:00.000Z`).getTime() -
        DUPLICATE_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const maxDate = new Date(
      new Date(`${periodTo}T00:00:00.000Z`).getTime() +
        DUPLICATE_LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const candidates = await this.expenseModel
      .find({
        tripId: new Types.ObjectId(boardId),
        paymentMethodId: new Types.ObjectId(paymentMethodId),
        expenseDate: { $gte: minDate, $lte: maxDate },
      })
      .lean();

    const candidateExpenses = candidates.map((expense) => ({
      id: expense._id.toString(),
      amount: expense.amount,
      currency: expense.currency,
      description: expense.description,
      merchantName: expense.merchantName,
      expenseDate: expense.expenseDate,
    }));

    const matches = matchStatementLines(lines, candidateExpenses);

    return lines.map((line, index) => {
      const match = matches[index];
      return {
        tempId: uuidv4(),
        date: line.date,
        description: line.description,
        amount: line.amount,
        currency: line.currency,
        cuotaActual: line.cuotaActual,
        cuotaTotal: line.cuotaTotal,
        confidence: line.confidence,
        parsedVia: line.parsedVia ?? StatementLineSource.REGEX,
        isPossibleDuplicate: match !== null,
        duplicateOfExpenseId: match
          ? new Types.ObjectId(match.expenseId)
          : undefined,
        duplicateOfDescription: match?.description,
        duplicateOfAmount: match?.amount,
        duplicateOfDate: match?.expenseDate.toISOString().slice(0, 10),
        rawText: line.rawText,
      };
    });
  }
}
