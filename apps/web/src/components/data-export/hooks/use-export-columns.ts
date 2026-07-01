// ~/components/data-export/hooks/use-export-columns.ts

'use client'

import type { ExportColumn } from '@auxx/lib/export/client'
import { toResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import { useResourceFields } from '~/components/resources/hooks'
import {
  useColumnLabels,
  useColumnOrder,
  useColumnVisibility,
} from '../../dynamic-table/stores/store-selectors'
import { decodeColumnId, isFieldColumnId } from '../../dynamic-table/utils/column-id'

/** Column snapshots for the two export entry points. */
export interface UseExportColumnsResult {
  /** Ordered, visible, field-only columns matching what the table shows. */
  viewColumns: ExportColumn[]
  /** Every (non-hidden) field on the entity — for a full dump. */
  allColumns: ExportColumn[]
}

/**
 * Resolve the column snapshots the exporter sends to the worker. `viewColumns`
 * mirror the active view (order + visibility + label overrides); `allColumns`
 * are all non-hidden fields on the entity. Each `fieldRef` is a `FieldReference`
 * (direct `ResourceFieldId` or a `FieldPath`) — passed verbatim to `batchGetValues`.
 */
export function useExportColumns(
  tableId: string,
  entityDefinitionId: string | undefined
): UseExportColumnsResult {
  const columnOrder = useColumnOrder(tableId)
  const columnVisibility = useColumnVisibility(tableId)
  const columnLabels = useColumnLabels(tableId)
  const { fields } = useResourceFields(entityDefinitionId ?? null)

  const viewColumns = useMemo<ExportColumn[]>(() => {
    if (!columnOrder) return []
    return columnOrder
      .filter((id) => columnVisibility?.[id] !== false)
      .filter((id) => isFieldColumnId(id))
      .map((id) => {
        const decoded = decodeColumnId(id)
        const fieldRef = decoded.type === 'direct' ? decoded.resourceFieldId : decoded.fieldPath
        const field = fields.find((f) => f.resourceFieldId === id || f.id === id)
        return { label: columnLabels[id] ?? field?.label ?? id, fieldRef }
      })
  }, [columnOrder, columnVisibility, columnLabels, fields])

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
