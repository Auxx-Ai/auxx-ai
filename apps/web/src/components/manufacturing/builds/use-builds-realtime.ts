// apps/web/src/components/manufacturing/builds/use-builds-realtime.ts
'use client'

import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Refetch the build reads on `build:changed` (plans/mrp/23-build-contract.md §4). Every build read
 * is invalidated, not only the named ids: a reversal changes the original's sheet too, and an undo
 * run's frame names only `batchRuns`. Only mounted queries refetch, so this stays cheap.
 */
export function useBuildsRealtime(): void {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string) => {
      if (event !== 'build:changed') return
      void utils.builds.get.invalidate()
      void utils.builds.list.invalidate()
      void utils.builds.getBatchRun.invalidate()
    },
    [utils]
  )

  useOrgChannel({ onEvent })
}
