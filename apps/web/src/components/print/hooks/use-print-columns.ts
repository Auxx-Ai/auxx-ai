// apps/web/src/components/print/hooks/use-print-columns.ts

'use client'

import type { ExportColumn } from '@auxx/lib/export/client'
import { useCallback, useMemo, useState } from 'react'
import { useExportColumns } from '~/components/data-export/hooks/use-export-columns'

/** Stable identity for an `ExportColumn` — `fieldRef` is a string or a path (string[]). */
export function columnKey(column: ExportColumn): string {
  return Array.isArray(column.fieldRef) ? column.fieldRef.join('.') : column.fieldRef
}

export interface UsePrintColumnsResult {
  /** Selected columns, in print order. */
  selected: ExportColumn[]
  /** Remaining columns available to add (view + all fields, minus selected). */
  available: ExportColumn[]
  addColumn: (column: ExportColumn) => void
  removeColumn: (column: ExportColumn) => void
  /** Reorder `selected` — receives the full new key order (see `CommandSortable`). */
  reorder: (keys: string[]) => void
}

/**
 * Print wizard "Content" page column state (list style). Seeded from
 * {@link useExportColumns} exactly like the CSV export flow — `viewColumns` preselected,
 * `allColumns` the addable pool — with local add/remove/reorder for the drag-to-reorder
 * picker (`PrintColumnPicker`).
 */
export function usePrintColumns(
  tableId: string,
  entityDefinitionId: string | undefined
): UsePrintColumnsResult {
  const { viewColumns, allColumns } = useExportColumns(tableId, entityDefinitionId)

  // Union of both pools, keyed for lookup — `viewColumns` can include relationship-path
  // columns `allColumns` doesn't carry (it's direct entity fields only).
  const pool = useMemo(() => {
    const map = new Map<string, ExportColumn>()
    for (const column of [...viewColumns, ...allColumns]) {
      if (!map.has(columnKey(column))) map.set(columnKey(column), column)
    }
    return map
  }, [viewColumns, allColumns])

  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => viewColumns.map(columnKey))

  const selected = useMemo(
    () => selectedKeys.map((key) => pool.get(key)).filter((c): c is ExportColumn => c != null),
    [selectedKeys, pool]
  )

  const available = useMemo(
    () => Array.from(pool.values()).filter((c) => !selectedKeys.includes(columnKey(c))),
    [pool, selectedKeys]
  )

  const addColumn = useCallback((column: ExportColumn) => {
    setSelectedKeys((prev) =>
      prev.includes(columnKey(column)) ? prev : [...prev, columnKey(column)]
    )
  }, [])

  const removeColumn = useCallback((column: ExportColumn) => {
    setSelectedKeys((prev) => prev.filter((key) => key !== columnKey(column)))
  }, [])

  const reorder = useCallback((keys: string[]) => {
    setSelectedKeys(keys)
  }, [])

  return { selected, available, addColumn, removeColumn, reorder }
}
