export interface CurrencyBreakdownEntry {
  currency: string;
  total: number;
  count: number;
}

/**
 * Buckets amounts by their own currency — no FX conversion. Used to keep
 * foreign-currency totals (e.g. USD) discriminated from the board's base
 * currency instead of blending them via a snapshot exchange rate.
 */
export class CurrencyBreakdownBuilder {
  private readonly totals = new Map<string, { total: number; count: number }>();

  add(currency: string, amount: number): void {
    const bucket = this.totals.get(currency) ?? { total: 0, count: 0 };
    bucket.total += amount;
    bucket.count += 1;
    this.totals.set(currency, bucket);
  }

  totalFor(currency: string): number {
    return this.totals.get(currency)?.total ?? 0;
  }

  /** Count across every currency, e.g. for "N movimientos" labels that don't split by currency. */
  totalCount(): number {
    let count = 0;
    for (const bucket of this.totals.values()) {
      count += bucket.count;
    }
    return count;
  }

  /** All bucketed currencies except `excludeCurrency` (typically the board's base currency). */
  otherThan(excludeCurrency: string): CurrencyBreakdownEntry[] {
    return [...this.totals.entries()]
      .filter(([currency]) => currency !== excludeCurrency)
      .map(([currency, data]) => ({
        currency,
        total: data.total,
        count: data.count,
      }));
  }
}
