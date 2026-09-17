// apps/web/src/components/accounting/hooks/use-provider-sync-run.ts
'use client'

// The inbound sync's run state, polled while a walk is open
// (plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §4.8).
//
// 🛑 POLL, DO NOT SUBSCRIBE. A walk is at most a dozen slices with no
// per-record progress worth streaming, so a re-read of the state blob on an
// interval is the whole requirement. `data-connectors/realtime.ts` exists;
// reach for it only if a backfill ever spans hundreds of slices.
//
// 🛑 NOT `useSettings`. The browser settings store hydrates from the `orgSettings`
// org cache, and the worker skips invalidating that cache on purpose because the
// blob is written after every slice - so a settings read would render a run
// several chunks stale. `ledger.providerSyncRunState` selects the row.

import { useEffect, useRef } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'

export type ProviderSyncRunState = RouterOutputs['ledger']['providerSyncRunState']
export type ProviderSyncRun = NonNullable<ProviderSyncRunState['currentRun']>

/** One slice is one provider report call, so a tighter poll would only cost round trips. */
const POLL_MS = 4_000

export interface UseProviderSyncRunResult {
  /** The open walk, or null. A `stale` one is a chain that died mid-slice (§7.4). */
  currentRun: ProviderSyncRun | null
  lastRun: ProviderSyncRun | null
  /** The open run has gone quiet past the takeover threshold, computed server-side. */
  stale: boolean
  isLoading: boolean
}

/**
 * What the sync rows render, and the invalidation that follows a finished run.
 *
 * The ledger, the marker every statement page renders and the balance check all
 * moved while the worker walked, and none of them is refetched by the poll that
 * noticed. Invalidating on the running -> finished edge is what makes the rest
 * of the app agree with the run the panel just reported.
 */
export function useProviderSyncRun(): UseProviderSyncRunResult {
  const utils = api.useUtils()
  const query = api.ledger.providerSyncRunState.useQuery(undefined, {
    refetchInterval: (q) => (q.state.data?.currentRun ? POLL_MS : false),
    retry: false,
  })

  const wasRunning = useRef(false)
  const isRunning = Boolean(query.data?.currentRun)
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      utils.ledgerReports.providerSyncMarker.invalidate()
      utils.ledger.listPostings.invalidate()
      utils.ledger.verifyBalance.invalidate()
    }
    wasRunning.current = isRunning
  }, [isRunning, utils])

  return {
    currentRun: query.data?.currentRun ?? null,
    lastRun: query.data?.lastRun ?? null,
    stale: query.data?.stale ?? false,
    isLoading: query.isPending,
  }
}
