import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import { toSafeErrorMessage } from '../../common/utils/log-redaction.util';
import {
  ParsedStatementLine,
  StatementLineSource,
} from './generic-statement-parser';

interface LlmLineResult {
  date: string | null;
  description: string | null;
  amount: number | null;
  currency: 'ARS' | 'USD' | null;
  cuotaActual: number | null;
  cuotaTotal: number | null;
  confidence: number;
}

/**
 * Fallback for individual low-confidence lines only — never the whole
 * document, and never anything beyond the single line's own text (no
 * account holder data, no other lines). Same Groq client pattern as
 * bot/parsers/llm-parser.service.ts.
 */
@Injectable()
export class StatementLlmFallbackService {
  private readonly logger = new Logger(StatementLlmFallbackService.name);
  private groq: Groq | null = null;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.enabled = !!apiKey;
    if (this.enabled) {
      this.groq = new Groq({ apiKey });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async resolveLine(line: ParsedStatementLine): Promise<ParsedStatementLine> {
    if (!this.enabled || !this.groq) return line;

    try {
      const response = await this.groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `Extraés un único movimiento de un resumen de tarjeta de crédito argentino a partir de una línea de texto. Respondé SOLO con JSON válido, sin texto adicional. Si no podés determinar un campo, usá null. "confidence" es un número entre 0 y 1.`,
          },
          {
            role: 'user',
            content: `Línea del resumen: "${line.rawText}"

Extraé:
- date: fecha en formato YYYY-MM-DD (la línea trae una fecha en formato DD.MM.AA, DD-MM-AA o DD/MM/AA)
- description: el nombre del comercio o concepto, sin la fecha ni el monto
- amount: el monto del consumo (número, sin separador de miles, con punto decimal, negativo si es un descuento/reintegro)
- currency: "ARS" o "USD"
- cuotaActual y cuotaTotal: si el consumo está en cuotas (ej "Cuota 03/06"), el número de cuota actual y el total; si no, null
- confidence: qué tan seguro estás de la extracción

Responde en este formato JSON:
{"date": "2026-08-07", "description": "FARMACITY 216", "amount": 30637.4, "currency": "ARS", "cuotaActual": null, "cuotaTotal": null, "confidence": 0.9}`,
          },
        ],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return line;

      const parsed = JSON.parse(content) as LlmLineResult;
      if (!parsed.amount || !parsed.description) return line;

      return {
        date: parsed.date ?? line.date,
        description: parsed.description,
        amount: parsed.amount,
        currency: parsed.currency ?? line.currency,
        cuotaActual: parsed.cuotaActual ?? line.cuotaActual,
        cuotaTotal: parsed.cuotaTotal ?? line.cuotaTotal,
        confidence: parsed.confidence,
        parsedVia: StatementLineSource.LLM,
        rawText: line.rawText,
      };
    } catch (error) {
      this.logger.warn(
        `Fallback LLM falló para una línea de resumen: ${toSafeErrorMessage(error)}`,
      );
      return line;
    }
  }
}
