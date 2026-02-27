// packages/lib/src/cache/promise-memoizer.ts

/**
 * Deduplicates concurrent async calls for the same key.
 * If a call for a given key is already in-flight, subsequent calls
 * share the same promise instead of starting a new one.
 */
export class PromiseMemoizer<T> {
  private pending = new Map<string, Promise<T>>()

  async memoize(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) return existing

    const promise = factory().finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }
}
