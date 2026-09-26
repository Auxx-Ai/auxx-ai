// apps/web/src/components/dynamic-table/utils/preference-write-queue.ts

const chains = new Map<string, Promise<unknown>>()

/**
 * Run `write` after every earlier write to the same preference row. `upsertPreference`
 * overwrites the whole config, so each writer builds its config inside `write` from the
 * store as it is then, never from a value captured before the previous write landed.
 */
export function enqueuePreferenceWrite(key: string, write: () => Promise<unknown>): Promise<void> {
  const next = (chains.get(key) ?? Promise.resolve()).then(write).then(
    () => undefined,
    () => undefined
  )
  chains.set(key, next)
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key)
  })
  return next
}

/** Resolves once every queued write to `key` has settled. */
export function preferenceWritesSettled(key: string): Promise<unknown> {
  return chains.get(key) ?? Promise.resolve()
}
