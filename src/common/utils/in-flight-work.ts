/** Shares overlapping work only; completed results are never cached. */
export class InFlightWork<T> {
  private readonly pending = new Map<
    string,
    { size: number; promise: Promise<T> }
  >();

  async run(key: string, size: number, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      const result = await existing.promise;
      if (existing.size >= size) return result;
      return this.run(key, size, work);
    }
    const promise = Promise.resolve().then(work);
    this.pending.set(key, { size, promise });
    try {
      return await promise;
    } finally {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    }
  }
}
