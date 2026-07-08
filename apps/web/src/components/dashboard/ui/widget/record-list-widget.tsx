// apps/web/src/components/dashboard/ui/widget/record-list-widget.tsx
'use client'

// Read-only record table rendered on the real `DynamicTable` in its standalone
// + hideToolbar reduced mode — so it inherits the records-table look (sticky
// gradient header, pinned primary column, ROW_HEIGHT rows, hover styling,
// virtualization) with none of the chrome: no toolbar, saved views, cell
// editing, checkboxes, or add-column button (see plans/dashboard/11).
//
// Fetch stays bespoke (`useRecordListData`, server-side filters/sort); only the
// presentation swaps. Cells self-hydrate via the app-wide record batch fetcher.
// Clicking a row/title emits the record id UP to the dashboard, which opens the
// `RecordDrawer` in the page-level docked panel (or a right-side overlay) — NOT
// inside the widget card, so a docked drawer doesn't render clipped in the tile.
// In edit mode clicks fall through so the card-level selection handler runs.

import type { RecordListConfig } from '@auxx/lib/dashboards/client'
import { toRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { useCallback, useMemo } from 'react'
import { DynamicTable } from '~/components/dynamic-table'
import { type RecordListRow, useRecordListColumns } from '../../hooks/use-record-list-columns'
import { useRecordListData } from '../../hooks/use-record-list-data'
import { WidgetEmpty, WidgetError, WidgetSkeleton, WidgetUnconfigured } from './widget-states'

export function RecordListWidget({
  config,
  widgetId,
  isEditMode,
  onConfigure,
  onOpenRecord,
}: {
  config: RecordListConfig
  widgetId?: string
  isEditMode: boolean
  onConfigure?: () => void
  /** Opens the record in the dashboard's page-level docked/overlay drawer. */
  onOpenRecord?: (recordId: RecordId) => void
}) {
  const { ids, entityDefinitionId, total, isLoading, isError, error } = useRecordListData(
    config,
    widgetId
  )

  const openRecord = useCallback(
    (instanceId: string) => onOpenRecord?.(toRecordId(entityDefinitionId, instanceId)),
    [entityDefinitionId, onOpenRecord]
  )

  const columns = useRecordListColumns({
    config,
    entityDefinitionId,
    isEditMode,
    onOpenRecord: openRecord,
  })

  const rows = useMemo<RecordListRow[]>(() => ids.map((id) => ({ id })), [ids])

  if (!config.source) {
    return (
      <WidgetUnconfigured
        message='Configure this widget'
        onConfigure={isEditMode ? onConfigure : undefined}
      />
    )
  }
  if (isLoading) return <WidgetSkeleton variant='list' />
  if (isError) return <WidgetError message={error?.message} />
  if (rows.length === 0) return <WidgetEmpty />

  return (
    <div className='flex flex-1 min-h-0 flex-col'>
      <div className='min-h-0 flex-1'>
        <DynamicTable
          data={rows}
          columns={columns}
          tableId={`dashboard-rl-${widgetId}`}
          standalone
          hideToolbar
          disableColumnDnd
          enableSearch={false}
          enableFiltering={false}
          enableSorting={false}
          showRowNumbers={false}
          isLoading={isLoading}
          emptyState={<WidgetEmpty />}
          getRowId={(row) => row.id}
          onRowClick={isEditMode ? undefined : (row) => openRecord(row.id)}
          className='h-full'
        />
      </div>

      <p className='shrink-0 border-t pt-1.5 text-muted-foreground text-xs'>
        Showing {rows.length} of {total}
      </p>
    </div>
  )
}
