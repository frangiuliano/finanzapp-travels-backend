export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'ARS',
  'BRL',
  'MXN',
  'COP',
  'CLP',
  'PEN',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: SupportedCurrency = 'USD';
