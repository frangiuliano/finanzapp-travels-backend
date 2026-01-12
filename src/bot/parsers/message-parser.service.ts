import { Injectable, Logger } from '@nestjs/common';
import { LLMParserService } from './llm-parser.service';

interface ParsedExpense {
  amount?: number;
  currency?: string;
  description?: string;
  paidBy?: 'user' | 'participant' | 'third';
  paidByName?: string;
  participantId?: string;
  isDivisible?: boolean;
  budgetName?: string;
  keywords?: string[];
}

interface ParseContext {
  tripName: string;
  participants: Array<{ id: string; name: string; isUser: boolean }>;
  budgets: Array<{ id: string; name: string }>;
  userName: string;
}

interface LLMParsedExpense {
  amount: number;
  currency: string;
  description: string;
  paidBy: 'user' | 'participant' | 'third';
  paidByName?: string;
  participantId?: string;
  isDivisible: boolean;
  budgetName?: string;
  confidence: number;
}

@Injectable()
export class MessageParserService {
  private readonly logger = new Logger(MessageParserService.name);

  private readonly currencyPatterns = {
    usd: /(?:usd|\$|dolar|dolares)/i,
    ars: /(?:ars|peso|pesos|\$ar)/i,
    eur: /(?:eur|euro|euros|€)/i,
  };

  constructor(private llmParser: LLMParserService) {}

  async parse(message: string, context?: ParseContext): Promise<ParsedExpense> {
    if (context) {
      const llmResult = await this.llmParser.parse(message, context);
      if (llmResult && llmResult.confidence > 0.7) {
        this.logger.log(
          `LLM parse exitoso (confidence: ${llmResult.confidence})`,
        );
        return this.convertLLMResult(llmResult);
      }
      this.logger.log(
        'LLM no tuvo suficiente confianza, usando fallback regex',
      );
    }

    return this.parseWithRegex(message);
  }

  private convertLLMResult(llmResult: LLMParsedExpense): ParsedExpense {
    return {
      amount: llmResult.amount,
      currency: llmResult.currency,
      description: llmResult.description,
      paidBy: llmResult.paidBy,
      paidByName: llmResult.paidByName,
      participantId: llmResult.participantId,
      isDivisible: llmResult.isDivisible,
      budgetName: llmResult.budgetName,
    };
  }

  private parseWithRegex(message: string): ParsedExpense {
    const result: ParsedExpense = {
      keywords: [],
    };

    const amountMatch = message.match(/(\d+(?:[.,]\d+)?)/);
    if (amountMatch) {
      result.amount = parseFloat(amountMatch[1].replace(',', '.'));
    }

    for (const [currency, pattern] of Object.entries(this.currencyPatterns)) {
      if (pattern.test(message)) {
        result.currency = currency.toUpperCase();
        break;
      }
    }

    result.description =
      message
        .replace(/(\d+(?:[.,]\d+)?)/g, '')
        .replace(/(?:usd|ars|eur|\$|€|dolar|peso|euro)/gi, '')
        .trim()
        .substring(0, 500) || 'Gasto sin descripción';

    result.isDivisible = /(?:compartido|entre todos|dividido)/i.test(message);

    if (/(?:pago|pagué|yo pagué|yo lo pagué)/i.test(message)) {
      result.paidBy = 'user';
    } else {
      const thirdPartyMatch = message.match(
        /(?:lo pagó|pagó|pagado por)\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i,
      );
      if (thirdPartyMatch) {
        result.paidBy = 'third';
        result.paidByName = thirdPartyMatch[1].trim();
      } else {
        result.paidBy = 'user';
      }
    }

    return result;
  }
}
