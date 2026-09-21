// packages/lib/src/field-hooks/batch-helpers.ts

// Shared plumbing for the `BatchCore`s the sync lane runs (plans/events/10 §4.4).

import type { EntityFieldChangeEvent, FieldChangeRef } from './types'

/** Minimal worker pool: `limit` lanes pulling from one cursor. Workers guard themselves. */
export async function runWithPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!
        await worker(item)
      }
    })
  )
}

/**
 * The slice of {@link EntityFieldChangeEvent} an extracted hook core reads, built from a
 * sync target plus the value the core just re-read from the store.
 */
export function refToEvent(ref: FieldChangeRef, newValue: unknown): EntityFieldChangeEvent {
  return {
    ...ref,
    oldValue: ref.oldValue ?? null,
    newValue,
    oldDisplay: null,
    newDisplay: null,
  }
}
