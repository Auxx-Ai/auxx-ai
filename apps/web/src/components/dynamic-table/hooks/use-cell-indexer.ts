// apps/web/src/components/dynamic-table/hooks/use-cell-indexer.ts
'use client'

import type { Table } from '@tanstack/react-table'
import { useEffect, useMemo, useRef } from 'react'
import { useSelectionStore, type VisibleIdMaps } from '../stores/selection-store'

/**
 * Hook: produce stable id↔index maps for the table's visible rows + columns
 * (excluding the checkbox column), and trigger range endpoint remapping
 * whenever the visible-id signature changes.
 *
 * Range math (drag-extension, keyboard-extension, fill-handle, overlay rect)
 * works in numeric index space; ids survive sort/filter/virtualization.
 * The store keeps both — this hook keeps the indexes fresh.
 */
export interface CellIndexer {
  rowIds: string[]
  columnIds: string[]
  rowIdToIndex: Map<string, number>
  columnIdToIndex: Map<string, number>
  /** Hash of `rowIds.join('|')` — change indicates the visible row set changed */
  rowSignature: string
  /** Hash of `columnIds.join('|')` */
  columnSignature: string
}

export function useCellIndexer<TData>(table: Table<TData>, tableId: string): CellIndexer {
  // visibleLeafColumns reflects current pinning/visibility/order — no need to
  // depend on those tanstack state slices separately.
  const rows = table.getRowModel().rows
  const visibleColumns = table.getVisibleLeafColumns()

  const rowSignature = useMemo(() => rows.map((r) => r.id).join('|'), [rows])

  const columnSignature = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.id !== '_checkbox')
        .map((c) => c.id)
        .join('|'),
    [visibleColumns]
  )

  const rowIds = useMemo(() => (rowSignature ? rowSignature.split('|') : []), [rowSignature])
  const columnIds = useMemo(
    () => (columnSignature ? columnSignature.split('|') : []),
    [columnSignature]
  )

  const rowIdToIndex = useMemo(() => {
    const m = new Map<string, number>()
    rowIds.forEach((id, i) => m.set(id, i))
    return m
  }, [rowIds])

  const columnIdToIndex = useMemo(() => {
    const m = new Map<string, number>()
    columnIds.forEach((id, i) => m.set(id, i))
    return m
  }, [columnIds])

  // Remap range endpoints when the visible id set changes.
  const lastRowSig = useRef<string | null>(null)
  const lastColSig = useRef<string | null>(null)

  useEffect(() => {
    if (lastRowSig.current === rowSignature && lastColSig.current === columnSignature) return
    lastRowSig.current = rowSignature
    lastColSig.current = columnSignature

    const maps: VisibleIdMaps = { rowIdToIndex, columnIdToIndex, rowIds, columnIds }
    useSelectionStore.getState().remapRange(tableId, maps)
  }, [rowSignature, columnSignature, rowIdToIndex, columnIdToIndex, rowIds, columnIds, tableId])

  return useMemo(
    () => ({ rowIds, columnIds, rowIdToIndex, columnIdToIndex, rowSignature, columnSignature }),
    [rowIds, columnIds, rowIdToIndex, columnIdToIndex, rowSignature, columnSignature]
  )
}
