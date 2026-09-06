/**
 * Bank-agnostic credit card statement parser.
 *
 * Deliberately NOT organized per-bank: Argentine card statements (HSBC,
 * Hipotecario, Galicia, and presumably others) all share the same
 * underlying shape — `fecha + referencia/comprobante + cuota opcional +
 * monto(s) en pesos/dólares` — with only cosmetic differences (date
 * separator, sign position, presence of the word "Cuota", a leading `*`
 * on the description). Adding a new bank should mean adjusting a regex
 * or a noise phrase here, never adding a new parser.
 *
 * A key real-world finding this design accounts for: text extracted from
 * a native PDF does NOT reliably preserve "one visual row = one line of
 * text" — two rows can end up glued together on the same text line. That
 * is why segmentation below anchors on the date pattern instead of on
 * newlines.
 */

export enum StatementLineSource {
  REGEX = 'regex',
  LLM = 'llm',
}

export interface ParsedStatementLine {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amount: number;
  currency: 'ARS' | 'USD';
  cuotaActual?: number;
  cuotaTotal?: number;
  confidence: number;
  parsedVia: StatementLineSource;
  rawText: string;
}

export interface ParsedStatementResult {
  lines: ParsedStatementLine[];
  lowConfidenceDocument: boolean;
}

const HEADER_RE = /FECHA[\s\S]{0,60}(DETALLE|REFERENCIA)[\s\S]{0,80}PESOS/i;

const FOOTER_MARKERS: RegExp[] = [
  /total a pagar/i,
  /estimado cliente/i,
  /condiciones vigentes/i,
  /debitaremos/i,
  /quiere pagar su resumen/i,
];

// Phrases that mean "this row is not a consumption, don't import it" —
// running balances and the cardholder's own payments toward the card.
// Real charges (interest, insurance, stamp duty) are intentionally NOT
// here: they are legitimate costs of the period and belong in the
// review list like any other line.
const NOISE_LINE_PATTERNS: RegExp[] = [
  /saldo\s+anterior/i,
  /saldo\s+actual/i,
  /su\s+pago\s+en\s+pesos/i,
  /su\s+pago\s+en\s+(d[oó]lares|usd)/i,
  /total\s+(de\s+)?consumos/i,
  /total\s+a\s+pagar/i,
];

// A per-card trailer ("TARJETA 1234 Total Consumos de FULANO") or the
// document's closing summary can end up glued onto the last real
// transaction's segment (it has no date of its own, so it attaches to
// whatever segment precedes it). Strip these from the tail before doing
// anything else, so they don't get mistaken for noise on a segment that
// also contains a real transaction, and don't pollute the description.
const TRAILING_SUMMARY_PATTERNS: RegExp[] = [
  /tarjeta\s+\d+\s+total\s+(de\s+)?consumos[\s\S]*$/i,
  /total\s+a\s+pagar[\s\S]*$/i,
];

function stripTrailingSummary(segment: string): string {
  let result = segment;
  for (const pattern of TRAILING_SUMMARY_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trimEnd();
}

const DATE_RE = /\b\d{2}[.\-/]\d{2}[.\-/]\d{2,4}\b/g;
const CUOTA_RE = /(?:cuota\s*)?(\d{1,2})\s*\/\s*(\d{1,2})/i;
const AMOUNT_RE = /-?\$?\s*\d[\d.]*,\d{2}-?/g;
const USD_MARKER_RE = /(usd|u\$s|d[oó]lares)/i;
const LEADING_REFERENCE_RE = /^([A-Z0-9]{4,10})[*]?\s+/;

const LOW_CONFIDENCE_THRESHOLD = 0.5;
const DOCUMENT_LOW_CONFIDENCE_RATIO = 0.4;

function extractTransactionBlock(fullText: string): string {
  const headerMatch = HEADER_RE.exec(fullText);
  const start = headerMatch ? headerMatch.index : 0;
  const afterHeader = fullText.slice(start);

  let end = afterHeader.length;
  for (const marker of FOOTER_MARKERS) {
    const match = marker.exec(afterHeader);
    if (match && match.index > 200 && match.index < end) {
      end = match.index;
    }
  }
  return afterHeader.slice(0, end);
}

function splitIntoSegments(block: string): string[] {
  const matches = [...block.matchAll(DATE_RE)];
  const segments: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : block.length;
    segments.push(stripTrailingSummary(block.slice(start, end)).trim());
  }
  return segments;
}

function normalizeDate(rawDate: string): string {
  const [d, m, yRaw] = rawDate.split(/[.\-/]/);
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseAmountToken(token: string): number {
  const trimmed = token.trim();
  const isNegative = trimmed.startsWith('-') || trimmed.endsWith('-');
  const cleaned = trimmed
    .replace(/[$\s-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const value = Math.abs(parseFloat(cleaned));
  return isNegative ? -value : value;
}

function isNoiseSegment(segment: string): boolean {
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(segment));
}

function parseSegment(segment: string): ParsedStatementLine | null {
  const dateMatch = /^\d{2}[.\-/]\d{2}[.\-/]\d{2,4}/.exec(segment);
  if (!dateMatch) return null;

  if (isNoiseSegment(segment)) return null;

  const date = normalizeDate(dateMatch[0]);
  let confidence = 1;

  const cuotaMatch = CUOTA_RE.exec(segment);
  const cuotaActual = cuotaMatch ? parseInt(cuotaMatch[1], 10) : undefined;
  const cuotaTotal = cuotaMatch ? parseInt(cuotaMatch[2], 10) : undefined;

  const amountMatches = [...segment.matchAll(AMOUNT_RE)];
  let amount = 0;
  let currency: 'ARS' | 'USD' = 'ARS';
  let chosenAmountText = '';

  if (amountMatches.length === 0) {
    confidence = 0.1;
  } else {
    const chosen = amountMatches[amountMatches.length - 1];
    chosenAmountText = chosen[0];
    amount = parseAmountToken(chosenAmountText);
    const textBeforeAmount = segment.slice(0, chosen.index);
    if (USD_MARKER_RE.test(textBeforeAmount)) {
      currency = 'USD';
    }
    if (amountMatches.length > 2) {
      confidence -= 0.3;
    }
  }

  let description = segment.slice(dateMatch[0].length);
  if (cuotaMatch) {
    description = description.replace(cuotaMatch[0], ' ');
  }
  if (chosenAmountText) {
    description = description.replace(chosenAmountText, ' ');
  }
  description = description.trimStart();
  const referenceMatch = LEADING_REFERENCE_RE.exec(description);
  if (referenceMatch && /\d/.test(referenceMatch[1])) {
    description = description.slice(referenceMatch[0].length);
  }
  description = description
    .replace(/^\*/, '')
    .replace(/\s+usd\b/i, '')
    .replace(/\s+u\$s\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (description.length < 3) {
    confidence -= 0.4;
    if (!description) description = 'Consumo sin descripción';
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    date,
    description,
    amount,
    currency,
    cuotaActual,
    cuotaTotal,
    confidence,
    parsedVia: StatementLineSource.REGEX,
    rawText: segment,
  };
}

export function parseStatementText(fullText: string): ParsedStatementResult {
  const block = extractTransactionBlock(fullText);
  const segments = splitIntoSegments(block);

  const lines = segments
    .map(parseSegment)
    .filter((line): line is ParsedStatementLine => line !== null);

  const lowConfidenceCount = lines.filter(
    (line) => line.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const lowConfidenceDocument =
    lines.length > 0 &&
    lowConfidenceCount / lines.length > DOCUMENT_LOW_CONFIDENCE_RATIO;

  return { lines, lowConfidenceDocument };
}
