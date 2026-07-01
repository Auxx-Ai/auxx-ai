// ~/components/data-export/hooks/use-export-list-realtime.ts

'use client'

import type { DataExportJobEvent } from '@auxx/lib/realtime'
import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Live updates for the export history list. Listens on the org channel for
 * `dataExport:job` and:
 *  - `progress` → patches the matching row's counters in the cached `list` (no refetch),
 *    so an in-flight export animates its processed/total in place.
 *  - `started` / `finished` → invalidates `list` to pull the authoritative rows
 *    (new job appears, status/fileName/size settle).
 *
 * Best-effort — the section keeps a slow safety poll so a dropped frame still converges.
 */
export function useExportListRealtime() {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dataExport:job') return
      const data = payload as DataExportJobEvent['data']

      if (data.kind === 'progress') {
        utils.dataExport.list.setData(undefined, (prev) =>
          prev?.map((job) =>
            job.id === data.exportJobId
              ? {
                  ...job,
                  processedRecords: data.processed ?? job.processedRecords,
                  totalRecords: data.total ?? job.totalRecords,
                }
              : job
          )
        )
        return
      }

      utils.dataExport.list.invalidate()
    },
    [utils]
  )

  useOrgChannel({ onEvent })
}
