// apps/web/src/components/signals/hooks/use-record-signals.ts
// Thin wrapper over `signal.listForRecordKeys` (client-notifications plan §4.8/Phase 4) — the
// one query behind every "Communications" surface (job section + drawer card, contact section).

import { api } from '~/trpc/react'

export interface UseRecordSignalsOptions {
  /** Caps the returned rows (default 100 — see the drawer card's compact `limit`). */
  limit?: number
  enabled?: boolean
}

/**
 * All `EntitySignal`s linked to any of `recordKeys`, newest first. `recordKeys` is expected to
 * be stable (memoized by the caller) — an empty array short-circuits the query rather than
 * hitting the backend's `min(1)` validation.
 */
export function useRecordSignals(recordKeys: string[], options: UseRecordSignalsOptions = {}) {
  const { limit, enabled = true } = options

  return api.signal.listForRecordKeys.useQuery(
    { recordKeys, limit },
    { enabled: enabled && recordKeys.length > 0 }
  )
}
