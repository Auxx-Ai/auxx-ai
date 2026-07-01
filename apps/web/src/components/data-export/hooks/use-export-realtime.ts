// ~/components/data-export/hooks/use-export-realtime.ts

'use client'

import type { DataExportJobEvent } from '@auxx/lib/realtime'
import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/**
 * Live progress for one export job. Listens on the org channel for
 * `dataExport:job` and:
 *  - `progress` → patches the cached `getById` counters in place (no refetch).
 *  - `started` / `finished` → invalidates `getById` to pull the authoritative
 *    row (status, fileName, size).
 *
 * Best-effort — the progress UI keeps a slow safety poll so a dropped frame
 * still converges.
 */
export function useExportJobRealtime(exportJobId: string | null) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'dataExport:job' || !exportJobId) return
      const data = payload as DataExportJobEvent['data']
      if (data.exportJobId !== exportJobId) return

      if (data.kind === 'progress') {
        utils.dataExport.getById.setData({ id: exportJobId }, (prev) =>
          prev
            ? {
                ...prev,
                processedRecords: data.processed ?? prev.processedRecords,
                totalRecords: data.total ?? prev.totalRecords,
              }
            : prev
        )
        return
      }

      utils.dataExport.getById.invalidate({ id: exportJobId })
    },
    [exportJobId, utils]
  )

  useOrgChannel({ onEvent })
}
