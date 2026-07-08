// apps/web/src/components/dashboard/ui/widget/record-list-widget.tsx
'use client'

// Compact read-only record table. Primary column is a self-hydrating
// `RecordBadge` (avatar + display name); configured columns reuse the records
// table's `CustomFieldCell` (also self-hydrating via the app-wide record batch
// fetcher). In view mode a row click opens the `RecordDrawer`; in edit mode
// clicks fall through so the card-level selection handler runs instead.

import type { RecordListConfig, WidgetFieldRef } from '@auxx/lib/dashboards/client'
import type { ResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { cn } from '@auxx/ui/lib/utils'
import { useState } from 'react'
import { CustomFieldCell } from '~/components/dynamic-table/components/custom-field-cell'
import { encodeFieldPathColumnId } from '~/components/dynamic-table/utils/column-id'
import { RecordDrawer } from '~/components/records/record-drawer'
import { useField } from '~/components/resources/hooks/use-field'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useRecordListData } from '../../hooks/use-record-list-data'
import { WidgetEmpty, WidgetError, WidgetSkeleton, WidgetUnconfigured } from './widget-states'

/** A `WidgetFieldRef` → the `columnId` string `CustomFieldCell` decodes. */
function columnId(ref: WidgetFieldRef): string {
  return typeof ref === 'string' ? ref : encodeFieldPathColumnId(ref)
}

/** The terminal `ResourceFieldId` of a ref, for header-label lookup. */
function terminalFieldId(ref: WidgetFieldRef): ResourceFieldId {
  return typeof ref === 'string' ? ref : ref[ref.length - 1]
}

export function RecordListWidget({
  config,
  widgetId,
  isEditMode,
  onConfigure,
}: {
  config: RecordListConfig
  widgetId?: string
  isEditMode: boolean
  onConfigure?: () => void
}) {
  const [openRecordId, setOpenRecordId] = useState<RecordId | null>(null)
  const { recordIds, total, isLoading, isError, error } = useRecordListData(config, widgetId)

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
  if (recordIds.length === 0) return <WidgetEmpty />

  const columns = config.columns ?? []

  return (
    <div className='flex flex-1 min-h-0 flex-col'>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full border-collapse text-sm'>
          <thead className='sticky top-0 bg-card'>
            <tr className='border-b text-left text-muted-foreground text-xs'>
              <th className='py-1.5 pe-2 font-normal'>Record</th>
              {columns.map((col) => (
                <ColumnHeader key={columnId(col)} fieldRef={col} />
              ))}
            </tr>
          </thead>
          <tbody>
            {recordIds.map((rid) => (
              <tr
                key={rid}
                className={cn('border-b last:border-0', !isEditMode && 'hover:bg-muted/40')}>
                <td className='py-1.5 pe-2'>
                  <button
                    type='button'
                    className={cn(
                      'max-w-full text-left',
                      isEditMode ? 'cursor-default' : 'cursor-pointer'
                    )}
                    onClick={() => {
                      if (!isEditMode) setOpenRecordId(rid)
                    }}>
                    <RecordBadge recordId={rid} size='sm' hoverCard={false} />
                  </button>
                </td>
                {columns.map((col) => (
                  <td key={columnId(col)} className='py-1.5 pe-2 align-top'>
                    <CustomFieldCell recordId={rid} columnId={columnId(col)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className='shrink-0 border-t pt-1.5 text-muted-foreground text-xs'>
        Showing {recordIds.length} of {total}
      </p>

      {!isEditMode && (
        <RecordDrawer
          open={Boolean(openRecordId)}
          recordId={openRecordId ?? undefined}
          onOpenChange={(open) => {
            if (!open) setOpenRecordId(null)
          }}
        />
      )}
    </div>
  )
}

/** Resolves a column's field label (terminal field for one-hop paths). */
function ColumnHeader({ fieldRef }: { fieldRef: WidgetFieldRef }) {
  const field = useField(terminalFieldId(fieldRef))
  return <th className='py-1.5 pe-2 font-normal'>{field?.label ?? '—'}</th>
}
