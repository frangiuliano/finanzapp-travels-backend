/** Argentina dollar "casa" — shared by DolarApi and ArgentinaDatos. */
export const ARGENTINA_FX_CASAS = [
  'oficial',
  'blue',
  'bolsa',
  'contadoconliqui',
  'mayorista',
  'tarjeta',
  'cripto',
  'solidario',
  'turista',
] as const;

export type ArgentinaFxCasa = (typeof ARGENTINA_FX_CASAS)[number];

export const DEFAULT_ARGENTINA_FX_CASA: ArgentinaFxCasa = 'oficial';

export function isArgentinaFxCasa(value: string): value is ArgentinaFxCasa {
  return (ARGENTINA_FX_CASAS as readonly string[]).includes(value);
}

export function isUsdToArsPair(
  fromCurrency: string,
  toCurrency: string,
): boolean {
  return fromCurrency === 'USD' && toCurrency === 'ARS';
}

export function isArsToUsdPair(
  fromCurrency: string,
  toCurrency: string,
): boolean {
  return fromCurrency === 'ARS' && toCurrency === 'USD';
}

/** Convert YYYY-MM-DD to ArgentinaDatos path segment YYYY/MM/DD */
export function toArgentinaDatosDatePath(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  return `${year}/${month}/${day}`;
}
