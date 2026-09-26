// apps/web/src/components/manufacturing/builds/use-backflush-run-realtime.ts
'use client'

import type { BackflushRunEvent } from '@auxx/lib/realtime/client'
import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** Live counters for one backflush run: `progress` patches the cached row, lifecycle edges refetch. */
export function useBackflushRunRealtime(runId: string | null) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'backflush:run' || !runId) return
      const data = payload as BackflushRunEvent['data']
      if (data.runId !== runId) return

      if (data.kind === 'progress') {
        utils.builds.getBackflushRun.setData({ runId }, (prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                processedDays: data.processed,
                totalDays: data.total,
                written: data.written,
                failed: data.failed,
              }
            : prev
        )
        return
      }
      void utils.builds.getBackflushRun.invalidate({ runId })
    },
    [runId, utils]
  )

  useOrgChannel({ onEvent })
}
