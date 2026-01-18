import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

interface ConversationContext {
  userName: string;
  trips: Array<{ id: string; name: string }>;
  participants: Array<{ id: string; name: string; isUser: boolean }>;
  budgets: Array<{ id: string; name: string }>;
  pendingExpense?: {
    amount?: number;
    currency?: string;
    description?: string;
    merchantName?: string;
    budgetId?: string;
    paidByParticipantId?: string;
    isDivisible?: boolean;
  };
  missingInfo?: {
    tripId?: boolean;
    budgetId?: boolean;
    paidBy?: boolean;
    merchantName?: boolean;
    paymentMethod?: boolean;
    isDivisible?: boolean;
  };
}

interface ConversationResponse {
  message: string;
  action?: 'ask_trip' | 'ask_budget' | 'ask_payer' | 'ask_split' | 'confirm';
  extractedData?: {
    tripId?: string;
    budgetId?: string;
    paidByParticipantId?: string;
    isDivisible?: boolean;
  };
}

@Injectable()
export class ConversationalService {
  private readonly logger = new Logger(ConversationalService.name);
  private groq: Groq | null = null;
  private readonly enabled: boolean;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.enabled = !!apiKey;

    if (this.enabled) {
      this.groq = new Groq({
        apiKey: apiKey,
      });
      this.logger.log('Conversational Service habilitado con Groq');
    } else {
      this.logger.warn(
        'GROQ_API_KEY no configurada, Conversational Service deshabilitado',
      );
    }
  }

  async generateResponse(
    userMessage: string,
    context: ConversationContext,
  ): Promise<ConversationResponse | null> {
    if (!this.enabled || !this.groq) {
      return null;
    }

    try {
      const prompt = this.buildConversationalPrompt(userMessage, context);

      const response = await this.groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente que ayuda a registrar gastos de viaje.

INSTRUCCIONES CRÍTICAS:
- Sé MUY CONCISO y directo al punto
- Haz preguntas cortas, sin explicaciones innecesarias
- Máximo 1-2 frases por mensaje
- Haz preguntas SOLO sobre la información específica que se te indique que falta
- NO preguntes por información que ya está disponible o que no se te pidió
- NO agregues contexto innecesario ni rodeos
- Usa emojis moderadamente (1 por mensaje máximo)
- Responde en español argentino informal pero respetuoso
- Sigue estrictamente las instrucciones específicas del prompt sobre qué preguntar`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 150,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return null;
      }

      const extractedData = this.extractDataFromMessage(userMessage, context);

      return {
        message: content.trim(),
        action: this.determineAction(context.missingInfo),
        extractedData,
      };
    } catch (error) {
      this.logger.error('Error en conversational service:', error);
      return null;
    }
  }

  async parseNaturalResponse(
    userMessage: string,
    context: ConversationContext,
    expectedInfo: 'trip' | 'budget' | 'payer' | 'split' | 'confirmation',
  ): Promise<{
    extracted?: {
      tripId?: string;
      budgetId?: string;
      paidByParticipantId?: string;
      isDivisible?: boolean;
      confirmed?: boolean;
    };
    understood: boolean;
  }> {
    if (!this.enabled || !this.groq) {
      return { understood: false };
    }

    try {
      const prompt = this.buildParsingPrompt(
        userMessage,
        context,
        expectedInfo,
      );

      const response = await this.groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `Eres un asistente que parsea respuestas naturales de usuarios sobre gastos de viaje y extrae información estructurada.

IMPORTANTE:
- Responde SOLO con JSON válido
- Si no entiendes, usa "understood": false
- Si entiendes, extrae la información relevante`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { understood: false };
      }

      const parsed = JSON.parse(content) as {
        understood: boolean;
        tripId?: string;
        budgetId?: string;
        paidByParticipantId?: string;
        isDivisible?: boolean;
        confirmed?: boolean;
      };

      return {
        extracted: parsed.understood ? parsed : undefined,
        understood: parsed.understood || false,
      };
    } catch (error) {
      this.logger.error('Error parseando respuesta natural:', error);
      return { understood: false };
    }
  }

  private buildConversationalPrompt(
    userMessage: string,
    context: ConversationContext,
  ): string {
    const tripsList = context.trips.map((t) => `- ${t.name}`).join('\n');

    const participantsList = context.participants
      .map((p) => `- ${p.name}${p.isUser ? ' (es el usuario actual)' : ''}`)
      .join('\n');

    const budgetsList = context.budgets.map((b) => `- ${b.name}`).join('\n');

    const expenseSummary = context.pendingExpense
      ? `
GASTO ACTUAL:
- Monto: ${context.pendingExpense.amount} ${context.pendingExpense.currency || 'USD'}
- Descripción: ${context.pendingExpense.description || 'Sin descripción'}
${context.pendingExpense.merchantName ? `- Comercio: ${context.pendingExpense.merchantName}` : ''}
${context.pendingExpense.paidByParticipantId ? '- Ya tiene pagador' : '- Falta definir quién pagó'}
${context.pendingExpense.budgetId ? '- Ya tiene presupuesto' : '- Falta definir presupuesto'}
${context.pendingExpense.isDivisible !== undefined ? `- Tipo: ${context.pendingExpense.isDivisible ? 'Compartido' : 'Personal'}` : '- Falta definir si es compartido'}
`
      : '';

    const missingInfoText = context.missingInfo
      ? `
INFORMACIÓN FALTANTE:
${context.missingInfo.tripId ? '- Falta seleccionar el viaje' : ''}
${context.missingInfo.budgetId ? '- Falta seleccionar el presupuesto' : ''}
${context.missingInfo.paidBy ? '- Falta saber quién pagó' : ''}
${context.missingInfo.merchantName ? '- Falta saber el nombre del comercio' : ''}
${context.missingInfo.paymentMethod ? '- Falta saber el método de pago (efectivo o tarjeta)' : ''}
${context.missingInfo.isDivisible ? '- Falta saber si es compartido o personal' : ''}
`
      : '';

    let specificQuestion = '';
    if (context.missingInfo) {
      if (context.missingInfo.tripId) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO por el viaje. Menciona los viajes disponibles en tu respuesta.';
      } else if (context.missingInfo.budgetId) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO por el presupuesto. Menciona los presupuestos disponibles en tu respuesta.';
      } else if (context.missingInfo.paidBy) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO quién pagó este gasto. Menciona los participantes disponibles si es relevante.';
      } else if (context.missingInfo.merchantName) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO por el nombre del comercio donde se hizo el gasto.';
      } else if (context.missingInfo.paymentMethod) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO por el método de pago (efectivo o tarjeta).';
      } else if (context.missingInfo.isDivisible) {
        specificQuestion =
          'IMPORTANTE: Debes preguntar SOLO si el gasto es compartido entre todos o personal.';
      }
    }

    return `Usuario dijo: "${userMessage}"

CONTEXTO:
- Usuario: ${context.userName}
${expenseSummary}
${missingInfoText}
VIAJES DISPONIBLES:
${tripsList}

PARTICIPANTES:
${participantsList}

PRESUPUESTOS DISPONIBLES:
${budgetsList}

Tu tarea: Genera una respuesta MUY CONCISA (máximo 1-2 frases):
1. ${specificQuestion || 'Si falta información, pregunta directamente sin rodeos'}
2. Si tienes toda la información, confirma brevemente antes de guardar
3. NO agregues contexto, explicaciones o información innecesaria
4. Ve directo al punto con la pregunta específica

IMPORTANTE: Sé extremadamente conciso. Solo pregunta lo necesario, sin introducciones largas ni contexto extra.

Responde solo con el mensaje para el usuario, sin JSON ni formato adicional.`;
  }

  private buildParsingPrompt(
    userMessage: string,
    context: ConversationContext,
    expectedInfo: string,
  ): string {
    const tripsList = context.trips.map((t) => `- ${t.name}`).join('\n');

    const participantsList = context.participants
      .map((p) => `- ${p.name}${p.isUser ? ' (es el usuario actual)' : ''}`)
      .join('\n');

    const budgetsList = context.budgets.map((b) => `- ${b.name}`).join('\n');

    return `El usuario dijo: "${userMessage}"

Estoy esperando información sobre: ${expectedInfo}

VIAJES: ${tripsList}
PARTICIPANTES: ${participantsList}
PRESUPUESTOS: ${budgetsList}

Extrae la información relevante en JSON. Si el usuario confirma algo (sí, claro, correcto, etc.), usa "confirmed": true.
Si menciona un viaje, participante o presupuesto, haz match por nombre con las opciones disponibles.

Formato esperado:
{
  "understood": true/false,
  "${expectedInfo === 'trip' ? 'tripId' : expectedInfo === 'budget' ? 'budgetId' : expectedInfo === 'payer' ? 'paidByParticipantId' : expectedInfo === 'split' ? 'isDivisible' : 'confirmed'}": "..."
}`;
  }

  private extractDataFromMessage(
    userMessage: string,
    context: ConversationContext,
  ): ConversationResponse['extractedData'] {
    const extracted: ConversationResponse['extractedData'] = {};

    if (context.missingInfo?.tripId) {
      const tripMatch = context.trips.find((t) =>
        userMessage.toLowerCase().includes(t.name.toLowerCase()),
      );
      if (tripMatch) {
        extracted.tripId = tripMatch.id;
      }
    }

    if (context.missingInfo?.budgetId) {
      const budgetMatch = context.budgets.find((b) =>
        userMessage.toLowerCase().includes(b.name.toLowerCase()),
      );
      if (budgetMatch) {
        extracted.budgetId = budgetMatch.id;
      }
    }

    if (context.missingInfo?.paidBy) {
      if (
        /(yo|mí|pagué|pague|yo pagué|lo pagué)/i.test(userMessage) ||
        context.participants.find((p) => p.isUser)
      ) {
        const userParticipant = context.participants.find((p) => p.isUser);
        if (userParticipant) {
          extracted.paidByParticipantId = userParticipant.id;
        }
      }
    }

    if (context.missingInfo?.isDivisible) {
      if (/(compartido|entre todos|dividido|todos)/i.test(userMessage)) {
        extracted.isDivisible = true;
      } else if (/(solo|mío|personal|propio)/i.test(userMessage)) {
        extracted.isDivisible = false;
      }
    }

    return Object.keys(extracted).length > 0 ? extracted : undefined;
  }

  private determineAction(
    missingInfo?: ConversationContext['missingInfo'],
  ): ConversationResponse['action'] {
    if (!missingInfo) {
      return 'confirm';
    }

    if (missingInfo.tripId) return 'ask_trip';
    if (missingInfo.budgetId) return 'ask_budget';
    if (missingInfo.paidBy) return 'ask_payer';
    if (missingInfo.isDivisible) return 'ask_split';
    return 'confirm';
  }
}
