// apps/web/src/components/manufacturing/builds/use-builds-realtime.ts
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** Frames inside this window share one round of refetches; a backflush or pricing pass sends many. */
export const BUILDS_REFRESH_MS = 500

/**
 * Refetch the build reads on `build:changed` (plans/mrp/23-build-contract.md §4). Every build read
 * is invalidated, not only the named ids: a reversal changes the original's sheet too, and an undo
 * run's frame names only `batchRuns`. Only mounted queries refetch.
 */
export function useBuildsRealtime(): void {
  const utils = api.useUtils()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const onEvent = useCallback(
    (event: string) => {
      if (event !== 'build:changed' || timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        void utils.builds.get.invalidate()
        void utils.builds.list.invalidate()
        void utils.builds.getBatchRun.invalidate()
        void utils.mrp.partItem.invalidate()
        // A completion or reversal posts in the same transaction, so the sheet's ledger moves too.
        void utils.ledger.listPostingsForSource.invalidate({ sourceKind: 'build' })
      }, BUILDS_REFRESH_MS)
    },
    [utils]
  )

  useOrgChannel({ onEvent })
}
