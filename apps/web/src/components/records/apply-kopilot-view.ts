// apps/web/src/components/records/apply-kopilot-view.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ColumnOrderState, SortingState, VisibilityState } from '@tanstack/react-table'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import type { TableUIConfig } from '~/components/dynamic-table/stores/store-types'
import type { TableView, ViewConfig } from '~/components/dynamic-table/types'

/**
 * Side-channel payload emitted by the kopilot record-view tools (on
 * `toolOutput._kopilotRecordView`). The SSE consumer hands it here to drive the
 * dynamic-table store — these are per-SESSION UI directives only (apply a
 * transient preview, or switch this user's table to the view they just
 * created/edited). The cross-client DATA refresh (view list, configs, default
 * flags) rides the `tableView:changed` realtime event, NOT this channel — so the
 * kopilot SSE hook never fetches. `set_default` is realtime-only (no payload).
 */
export interface KopilotRecordViewPayload {
  kind: 'preview' | 'created' | 'updated'
  tableId: string
  // preview
  filters?: ConditionGroup[]
  sorting?: SortingState
  columnVisibility?: VisibilityState
  columnOrder?: ColumnOrderState
  // created / updated — the persisted view to optimistically show + select
  view?: TableView
}

/** Strip filters off a ViewConfig to get the UI-config slice the store holds. */
function toUIConfig(config: ViewConfig): TableUIConfig {
  const { filters: _filters, ...ui } = config
  return ui as TableUIConfig
}

/** Apply a kopilot record-view UI directive to the live table store (no fetch). */
export function applyKopilotRecordView(payload: KopilotRecordViewPayload): void {
  const store = useDynamicTableStore.getState()

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
    return
  }

  // created / updated — optimistically register/re-seed the persisted view and
  // switch to it so the author sees the result instantly. The realtime event
  // reconciles the canonical list across every client right after.
  const view = payload.view
  if (!view) return
  const config = view.config as ViewConfig

  if (payload.kind === 'created') {
    store.addView(view)
  } else {
    store.updateViewMeta(view.id, {
      name: view.name,
      isShared: view.isShared,
      isDefault: view.isDefault,
    })
    store.setViewConfig(view.id, toUIConfig(config))
    store.setViewFilters(view.id, config.filters ?? [])
  }
  store.setActiveView(payload.tableId, view.id)
}
