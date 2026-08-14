// ~/components/data-export/hooks/use-export-columns.ts

'use client'

import type { ExportColumn } from '@auxx/lib/export/client'
import { toResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import { useResourceFields } from '~/components/resources/hooks'
import { useTableInstance } from '../../dynamic-table/context/table-instance-context'
import { useColumnLabels } from '../../dynamic-table/stores/store-selectors'
import { decodeColumnId, isFieldColumnId } from '../../dynamic-table/utils/column-id'

/** Column snapshots for the two export entry points. */
export interface UseExportColumnsResult {
  /** Field columns exactly as the table renders them — same order, same visibility. */
  viewColumns: ExportColumn[]
  /** Every (non-hidden) field on the entity — for a full dump. */
  allColumns: ExportColumn[]
}

/**
 * Resolve the column snapshots the exporter sends to the worker. `viewColumns`
 * come from the rendered table instance (`getVisibleLeafColumns`), so the export
 * matches what the user sees — including columns the view's saved `columnOrder`
 * doesn't list, which the table appends in definition order. `allColumns` are all
 * non-hidden fields on the entity. Each `fieldRef` is a `FieldReference` (direct
 * `ResourceFieldId` or a `FieldPath`) — passed verbatim to `batchGetValues`.
 *
 * Must be used within a `TableInstanceProvider`.
 */
export function useExportColumns(
  tableId: string,
  entityDefinitionId: string | undefined
): UseExportColumnsResult {
  const { table } = useTableInstance()
  const columnLabels = useColumnLabels(tableId)
  const { fields } = useResourceFields(entityDefinitionId ?? null)

  // Computed per render, not memoized: the table instance is referentially stable
  // while its column state mutates, so a memo keyed on it would go stale.
  const viewColumns: ExportColumn[] = table
    .getVisibleLeafColumns()
    .map((column) => column.id)
    .filter((id) => isFieldColumnId(id))
    .map((id) => {
      const decoded = decodeColumnId(id)
      const fieldRef = decoded.type === 'direct' ? decoded.resourceFieldId : decoded.fieldPath
      const field = fields.find((f) => f.resourceFieldId === id || f.id === id)
      return { label: columnLabels[id] ?? field?.label ?? id, fieldRef }
    })

  const allColumns = useMemo<ExportColumn[]>(() => {
    if (!entityDefinitionId) return []
    return fields
      .filter((f) => !f.capabilities.hidden)
      .map((f) => ({
        label: f.label,
        fieldRef: f.resourceFieldId ?? toResourceFieldId(entityDefinitionId, f.id),
      }))
  }, [fields, entityDefinitionId])

  return { viewColumns, allColumns }
}
