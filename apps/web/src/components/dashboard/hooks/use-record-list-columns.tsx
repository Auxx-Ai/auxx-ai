// apps/web/src/components/dashboard/hooks/use-record-list-columns.tsx
'use client'

// Builds the column defs for a record-list widget rendered on `DynamicTable`
// (standalone + hideToolbar reduced mode). Mirrors `DynamicResourceView`'s
// primary + entity-field columns, but config-driven (explicit `config.columns`)
// and with every interaction knob off — no sort/filter/hide/resize/reorder —
// because the widget's sort/filter are server-side and any header interaction
// would write to the session-only view store and lie on reload.
//
// Cells self-hydrate: `PrimaryFieldCell` (primary display field) and
// `CustomFieldCell` (configured columns) both fetch their own values through
// the app-wide record batch fetcher, so no value stitching is needed here.

import type { RecordListConfig } from '@auxx/lib/dashboards/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { CustomFieldCell, getIconForFieldType, PrimaryFieldCell } from '~/components/dynamic-table'
import { useResource } from '~/components/resources'
import { useFields } from '~/components/resources/hooks/use-field'
import { columnId, terminalFieldId } from '../lib/column-ref'

/** Plain row: an entity-instance id. Cells re-brand with the entity def id. */
export interface RecordListRow {
  id: string
}

interface UseRecordListColumnsOptions {
  config: RecordListConfig
  entityDefinitionId: string
  /** Read-only edit mode — suppresses the drawer-opening title click. */
  isEditMode: boolean
  /** Opens the record drawer for a row's instance id (view mode only). */
  onOpenRecord: (instanceId: string) => void
}

/**
 * Column defs for the record-list widget: a pinned primary column
 * (`PrimaryFieldCell`, no kebab) followed by the configured field columns
 * (`CustomFieldCell`). All static — sorting/filtering/hiding/resizing off.
 */
export function useRecordListColumns({
  config,
  entityDefinitionId,
  isEditMode,
  onOpenRecord,
}: UseRecordListColumnsOptions): ExtendedColumnDef<RecordListRow>[] {
  const { resource } = useResource(entityDefinitionId)

  const cols = useMemo(() => config.columns ?? [], [config.columns])

  // Resolve terminal-field metadata (label + type) for every configured column
  // in one shallow-compared subscription.
  const terminalRefs = useMemo(() => cols.map(terminalFieldId), [cols])
  const fields = useFields(terminalRefs)

  // The records-table primary column: primary display field (fallback first
  // field), rendered through `PrimaryFieldCell` for field-formatted value +
  // record icon + connector source badge.
  const primaryFieldId = resource?.display.primaryDisplayField?.id ?? resource?.fields[0]?.id
  const primaryResourceFieldId = useMemo(() => {
    if (!entityDefinitionId || !primaryFieldId) return null
    return toResourceFieldId(entityDefinitionId, toFieldId(primaryFieldId))
  }, [entityDefinitionId, primaryFieldId])
  const primaryFieldLabel = resource?.fields.find((f) => f.id === primaryFieldId)?.label

  return useMemo(() => {
    const columns: ExtendedColumnDef<RecordListRow>[] = []

    if (primaryResourceFieldId) {
      columns.push({
        id: primaryResourceFieldId,
        accessorFn: () => undefined,
        header: primaryFieldLabel ?? 'Record',
        primaryCell: true,
        enableSorting: false,
        enableFiltering: false,
        enableHiding: false,
        enableResizing: false,
        enableResize: false,
        minSize: 140,
        size: 220,
        cell: ({ row }) => (
          <PrimaryFieldCell
            resourceFieldId={primaryResourceFieldId}
            rowId={row.original.id}
            onTitleClick={() => {
              if (!isEditMode) onOpenRecord(row.original.id)
            }}
          />
        ),
      })
    }

    cols.forEach((col, i) => {
      const field = fields[i]
      const id = columnId(col)
      // The primary display field is already the pinned primary column — never
      // render it twice (legacy configs may still list it among `columns`).
      if (id === primaryResourceFieldId) return
      columns.push({
        id,
        accessorFn: () => undefined,
        header: field?.label ?? '—',
        fieldType: field?.fieldType,
        icon: field?.fieldType ? getIconForFieldType(field.fieldType) : undefined,
        enableSorting: false,
        enableFiltering: false,
        enableHiding: false,
        enableResizing: false,
        enableResize: false,
        minSize: 100,
        size: 150,
        cell: ({ row }) => (
          <CustomFieldCell
            recordId={toRecordId(entityDefinitionId, row.original.id)}
            columnId={id}
          />
        ),
      })
    })

    return columns
  }, [
    cols,
    fields,
    entityDefinitionId,
    primaryResourceFieldId,
    primaryFieldLabel,
    isEditMode,
    onOpenRecord,
  ])
}
