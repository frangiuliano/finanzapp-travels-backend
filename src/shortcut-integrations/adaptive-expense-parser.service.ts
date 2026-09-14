import { Injectable } from '@nestjs/common';

export interface ShortcutParserOption {
  id: string;
  name: string;
  aliases?: string[];
}

export interface AdaptiveExpenseParseContext {
  boardCurrency: string;
  categories: ShortcutParserOption[];
  paymentMethods: ShortcutParserOption[];
}

export interface AdaptiveExpenseSuggestion {
  amount?: number;
  currency: string;
  merchantName?: string;
  description?: string;
  categoryId?: string;
  paymentMethodId?: string;
  missingFields: Array<
    'amount' | 'merchantName' | 'categoryId' | 'paymentMethodId'
  >;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseLocalizedAmount(raw: string): number | undefined {
  const compact = raw.replace(/\s/g, '');
  let normalized = compact;

  if (compact.includes('.') && compact.includes(',')) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  } else if (/^\d{1,3}(?:,\d{3})+$/.test(compact)) {
    normalized = compact.replace(/,/g, '');
  } else {
    normalized = compact.replace(',', '.');
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

@Injectable()
export class AdaptiveExpenseParserService {
  parse(
    input: string,
    context: AdaptiveExpenseParseContext,
  ): AdaptiveExpenseSuggestion {
    const normalizedInput = normalize(input);
    const amountMatch = input.match(
      /\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/,
    );
    const amount = amountMatch
      ? parseLocalizedAmount(amountMatch[0])
      : undefined;
    const currency = this.resolveCurrency(
      normalizedInput,
      context.boardCurrency,
    );
    const category = this.findBestMatch(normalizedInput, context.categories);
    const paymentMethod = this.findBestMatch(
      normalizedInput,
      context.paymentMethods,
    );

    const merchantName = this.resolveMerchant(input, amountMatch?.[0], [
      ...(category ? [category] : []),
      ...(paymentMethod ? [paymentMethod] : []),
    ]);

    const missingFields: AdaptiveExpenseSuggestion['missingFields'] = [];
    if (!amount) missingFields.push('amount');
    if (!merchantName) missingFields.push('merchantName');
    if (!category) missingFields.push('categoryId');
    if (!paymentMethod) missingFields.push('paymentMethodId');

    return {
      amount,
      currency,
      merchantName,
      description: merchantName,
      categoryId: category?.id,
      paymentMethodId: paymentMethod?.id,
      missingFields,
    };
  }

  private resolveCurrency(input: string, fallback: string): string {
    const patterns: Array<[string, RegExp]> = [
      ['USD', /\b(?:usd|dolar|dolares)\b/],
      ['EUR', /\b(?:eur|euro|euros)\b/],
      ['ARS', /\b(?:ars|peso|pesos)\b/],
      ['BRL', /\b(?:brl|real|reales)\b/],
      ['MXN', /\bmxn\b/],
      ['COP', /\bcop\b/],
      ['CLP', /\bclp\b/],
      ['PEN', /\b(?:pen|sol|soles)\b/],
    ];
    return patterns.find(([, pattern]) => pattern.test(input))?.[0] ?? fallback;
  }

  private findBestMatch(
    input: string,
    options: ShortcutParserOption[],
  ): ShortcutParserOption | undefined {
    const matches = options
      .map((option) => {
        const terms = [option.name, ...(option.aliases ?? [])]
          .map(normalize)
          .filter((term) => term.length >= 2);
        const matchingTerm = terms
          .filter((term) =>
            new RegExp(`(?:^| )${this.escape(term)}(?: |$)`).test(input),
          )
          .sort((a, b) => b.length - a.length)[0];
        return matchingTerm ? { option, score: matchingTerm.length } : null;
      })
      .filter(
        (value): value is { option: ShortcutParserOption; score: number } =>
          value !== null,
      )
      .sort((a, b) => b.score - a.score);

    if (matches.length > 1 && matches[0].score === matches[1].score) {
      return undefined;
    }
    return matches[0]?.option;
  }

  private resolveMerchant(
    input: string,
    rawAmount: string | undefined,
    matchedOptions: ShortcutParserOption[],
  ): string | undefined {
    let candidate = input;
    if (rawAmount) candidate = candidate.replace(rawAmount, ' ');

    const removableTerms = [
      'usd',
      'ars',
      'eur',
      'brl',
      'mxn',
      'cop',
      'clp',
      'pen',
      'dolar',
      'dolares',
      'peso',
      'pesos',
      'euro',
      'euros',
      ...matchedOptions.flatMap((option) => [
        option.name,
        ...(option.aliases ?? []),
      ]),
    ].sort((a, b) => b.length - a.length);

    for (const term of removableTerms) {
      candidate = candidate.replace(new RegExp(this.escape(term), 'gi'), ' ');
    }

    candidate = candidate
      .replace(/[€$]/g, ' ')
      .replace(/\b(?:con|en|usando|pague|pago|gaste|gasto|tarjeta)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[,;:-]+|[,;:-]+$/g, '')
      .trim();

    if (candidate) return candidate.slice(0, 100);
    return matchedOptions[0]?.name.slice(0, 100);
  }

  private escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
