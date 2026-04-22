// apps/web/src/components/dynamic-table/hooks/use-range-drag.ts
'use client'

import { useCallback, useRef } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type { RangeEndpoint } from '../types'
import type { CellIndexer } from './use-cell-indexer'
import { usePointerDrag } from './use-pointer-drag'

interface UseRangeDragOptions {
  tableId: string
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  indexer: CellIndexer
}

/**
 * Resolve the cell ids under a pointer position. Walks up from
 * `elementFromPoint` to find the nearest `[data-row-id][data-column-id]`.
 */
function findCellIdsAtPoint(x: number, y: number): { rowId: string; columnId: string } | null {
  const el = document.elementFromPoint(x, y)
  if (!el) return null
  const target = el.closest('[data-row-id][data-column-id]') as HTMLElement | null
  if (!target) return null
  const rowId = target.dataset.rowId
  const columnId = target.dataset.columnId
  if (!rowId || !columnId) return null
  if (columnId === '_checkbox') return null
  return { rowId, columnId }
}

/**
 * Extend the active range's focus as the pointer moves. `beginDrag(endpoint)`
 * starts a drag from an anchor; subsequent pointer movement updates the
 * store's range focus. Consumes `usePointerDrag` for the shared plumbing.
 */
export function useRangeDrag({
  tableId,
  enabled,
  scrollContainerRef,
  indexer,
}: UseRangeDragOptions) {
  const indexerRef = useRef(indexer)
  indexerRef.current = indexer

  const { begin } = usePointerDrag({ enabled, scrollContainerRef })

  const updateFocusFromPoint = useCallback(
    (x: number, y: number) => {
      const ids = findCellIdsAtPoint(x, y)
      if (!ids) return
      const idx = indexerRef.current
      const rowIndex = idx.rowIdToIndex.get(ids.rowId)
      const colIndex = idx.columnIdToIndex.get(ids.columnId)
      if (rowIndex === undefined || colIndex === undefined) return
      const focus: RangeEndpoint = { ...ids, rowIndex, colIndex }
      useSelectionStore.getState().setRangeFocus(tableId, focus)
    },
    [tableId]
  )

  /**
   * Begin a drag.
   *  - `anchorEndpoint` becomes the range anchor and initial focus.
   *  - `extend` (shift+drag): keep existing anchor, set focus to anchorEndpoint.
   */
  const beginDrag = useCallback(
    (
      anchorEndpoint: RangeEndpoint,
      pointerId: number,
      pointerX: number,
      pointerY: number,
      options: { extend?: boolean } = {}
    ) => {
      const store = useSelectionStore.getState()
      const existing = store.getRange(tableId)

      if (options.extend && existing) {
        store.setRange(tableId, { anchor: existing.anchor, focus: anchorEndpoint })
      } else {
        store.setRange(tableId, { anchor: anchorEndpoint, focus: anchorEndpoint })
      }

      begin({
        pointerId,
        pointerX,
        pointerY,
        cursor: 'cell',
        onMove: updateFocusFromPoint,
        onEnd: () => {},
      })
    },
    [tableId, begin, updateFocusFromPoint]
  )

  return { beginDrag }
}
