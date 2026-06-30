// apps/web/src/components/dynamic-table/hooks/use-table-view-realtime.ts
'use client'

import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import type { TableView } from '../types'

/**
 * Subscribe the records page to `tableView:changed` realtime events. When a
 * saved view is created / edited / made default anywhere in the org (today: the
 * Kopilot record-view tools), refetch the authoritative list and re-seed the
 * dynamic-table store. This is the cross-client refresh path — the kopilot SSE
 * hook only handles per-session UI directives, never data fetches.
 *
 * Mounted by `RecordsView`, so it only runs on records pages.
 */
export function useTableViewRealtime(): void {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'tableView:changed') return
      const tableId = (payload as { tableId?: string } | null)?.tableId
      void utils.tableView.listAll.fetch().then((all) => {
        const views = (all ?? []) as TableView[]
        const store = useDynamicTableStore.getState()
        if (tableId) {
          store.setTableViews(
            tableId,
            views.filter((v) => v.tableId === tableId)
          )
        } else {
          store.setAllViews(views)
        }
      })
    },
    [utils]
  )

  useOrgChannel({ onEvent })
}
