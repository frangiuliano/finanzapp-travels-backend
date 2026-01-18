import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

interface ParsedExpense {
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

interface ParseContext {
  tripName: string;
  participants: Array<{ id: string; name: string; isUser: boolean }>;
  budgets: Array<{ id: string; name: string }>;
  userName: string;
}

@Injectable()
export class LLMParserService {
  private readonly logger = new Logger(LLMParserService.name);
  private groq: Groq | null = null;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.enabled = !!apiKey;

    if (this.enabled) {
      this.groq = new Groq({
        apiKey: apiKey,
      });
      this.logger.log('LLM Parser habilitado con Groq');
    } else {
      this.logger.warn('GROQ_API_KEY no configurada, LLM Parser deshabilitado');
    }
  }

  async parse(
    message: string,
    context: ParseContext,
  ): Promise<ParsedExpense | null> {
    if (!this.enabled || !this.groq) {
      return null;
    }

    try {
      const prompt = this.buildPrompt(message, context);

      const response = await this.groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente que parsea mensajes informales sobre gastos de viaje y los convierte a un formato estructurado JSON.

IMPORTANTE:
- Responde SOLO con JSON válido, sin texto adicional
- Si no estás seguro de algún campo, usa null
- El campo "confidence" debe ser un número entre 0 y 1
- Si el mensaje no parece ser un gasto, retorna null en todos los campos numéricos`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content) as ParsedExpense;

      // Validar que al menos tenemos monto y descripción
      if (!parsed.amount || !parsed.description) {
        this.logger.warn('LLM no pudo extraer monto o descripción');
        return null;
      }

      return parsed;
    } catch (error) {
      this.logger.error('Error en LLM parser:', error);
      return null;
    }
  }

  private buildPrompt(message: string, context: ParseContext): string {
    const participantsList = context.participants
      .map(
        (p) =>
          `- ${p.name} (ID: ${p.id}${p.isUser ? ', es el usuario actual' : ''})`,
      )
      .join('\n');

    const budgetsList = context.budgets
      .map((b) => `- ${b.name} (ID: ${b.id})`)
      .join('\n');

    return `Analiza este mensaje sobre un gasto de viaje y extrae la información:

MENSAJE: "${message}"

CONTEXTO:
- Viaje: ${context.tripName}
- Usuario actual: ${context.userName}
- Participantes disponibles:
${participantsList}
- Presupuestos disponibles:
${budgetsList}

INSTRUCCIONES:
1. Extrae el MONTO (número)
2. Extrae la MONEDA (USD, ARS, EUR, etc.) - si no se menciona, usa USD
3. Extrae la DESCRIPCIÓN del gasto
4. Determina QUIÉN PAGÓ:
   - "user": si el usuario actual pagó (ej: "pagué yo", "yo pagué", "lo pagué")
   - "participant": si un participante pagó (usa el participantId correspondiente)
   - "third": si alguien externo pagó (usa paidByName)
5. Determina si es DIVISIBLE (compartido): true si menciona "compartido", "entre todos", "dividido", etc.
6. Si menciona un presupuesto, intenta hacer match con los disponibles (usa budgetName)
7. Calcula CONFIDENCE (0-1): qué tan seguro estás de la extracción

Responde en este formato JSON:
{
  "amount": 120.0,
  "currency": "USD",
  "description": "Cena en restaurante",
  "paidBy": "user",
  "paidByName": null,
  "participantId": null,
  "isDivisible": true,
  "budgetName": "Comidas",
  "confidence": 0.95
}`;
  }
}
