// packages/utils/src/counter.ts

/**
 * A stateful monotonic counter. Each call returns the next integer, starting
 * at `start + 1`. The closure keeps the state local, so separate counters
 * never interfere — safe to create one per request, per document, etc.
 *
 * @param start - The value before the first emission (default 0 → first call returns 1).
 */
export function createCounter(start = 0): () => number {
  let n = start
  return () => ++n
}

/**
 * A prefixed-string id allocator backed by {@link createCounter}. Hands out
 * short, sequential, human-readable ids — e.g. `createIdAllocator('b', 4)`
 * yields `'b5'`, `'b6'`, … Useful anywhere a per-scope auto-increment is
 * wanted (KB block ids, list keys, etc.) instead of a random id.
 *
 * @param prefix - Prepended to every id (default '').
 * @param start - The number before the first emission (default 0 → first id is `${prefix}1`).
 */
export function createIdAllocator(prefix = '', start = 0): () => string {
  const next = createCounter(start)
  return () => `${prefix}${next()}`
}
