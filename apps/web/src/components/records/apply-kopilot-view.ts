// apps/web/src/components/records/apply-kopilot-view.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ColumnOrderState, SortingState, VisibilityState } from '@tanstack/react-table'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import type { TableUIConfig } from '~/components/dynamic-table/stores/store-types'
import type { TableView } from '~/components/dynamic-table/types'

/**
 * Side-channel payload emitted by the kopilot `preview_table_view` /
 * `create_table_view` tools (on `toolOutput._kopilotRecordView`). The SSE
 * consumer hands it here to drive the dynamic-table store, reusing the same
 * store actions the records UI uses for manual filter/sort/column changes.
 */
export interface KopilotRecordViewPayload {
  kind: 'preview' | 'created'
  tableId: string
  // preview
  filters?: ConditionGroup[]
  sorting?: SortingState
  columnVisibility?: VisibilityState
  columnOrder?: ColumnOrderState
  // created
  view?: TableView
}

/** Apply a kopilot record-view directive to the live table store. */
export function applyKopilotRecordView(payload: KopilotRecordViewPayload): void {
  const store = useDynamicTableStore.getState()

  if (payload.kind === 'created' && payload.view) {
    // Optimistically register + select the new saved view (cache refetch reconciles).
    store.addView(payload.view)
    store.setActiveView(payload.tableId, payload.view.id)
    return
  }

  if (payload.kind === 'preview') {
    // Drop any active saved view so the session layer drives the preview.
    store.setActiveView(payload.tableId, null)
    store.setSessionFilters(payload.tableId, payload.filters ?? [])

    const uiChanges: Partial<TableUIConfig> = {}
    if (payload.sorting) uiChanges.sorting = payload.sorting
    if (payload.columnVisibility) uiChanges.columnVisibility = payload.columnVisibility
    if (payload.columnOrder) uiChanges.columnOrder = payload.columnOrder
    if (Object.keys(uiChanges).length > 0) {
      store.updateSessionConfig(payload.tableId, uiChanges)
    }
  }
}
