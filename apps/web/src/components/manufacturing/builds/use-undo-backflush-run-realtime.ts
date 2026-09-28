// apps/web/src/components/manufacturing/builds/use-undo-backflush-run-realtime.ts
'use client'

import type { UndoBackflushRunEvent } from '@auxx/lib/realtime/client'
import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** Live counters for one undo run: `progress` patches the cached row, lifecycle edges refetch. */
export function useUndoBackflushRunRealtime(runId: string | null) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'backflush:undo' || !runId) return
      const data = payload as UndoBackflushRunEvent['data']
      if (data.runId !== runId) return

      if (data.kind === 'progress') {
        utils.builds.getUndoBackflushRun.setData({ runId }, (prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                processed: data.processed,
                total: data.total,
                reversed: data.reversed,
                cancelled: data.cancelled,
                failed: data.failed,
              }
            : prev
        )
        return
      }
      void utils.builds.getUndoBackflushRun.invalidate({ runId })
    },
    [runId, utils]
  )

  useOrgChannel({ onEvent })
}
