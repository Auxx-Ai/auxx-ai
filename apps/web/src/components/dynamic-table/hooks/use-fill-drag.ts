// apps/web/src/components/dynamic-table/hooks/use-fill-drag.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { useSelectionStore } from '../stores/selection-store'
import type { CellRange, CellSelectionConfig, CopyCellPayload, RangeEndpoint } from '../types'
import { type CoerceReason, coerceForPaste, reasonToLabel } from '../utils/cell-coercion'
import { rangeBounds } from '../utils/range'
import type { CellIndexer } from './use-cell-indexer'
import { usePointerDrag } from './use-pointer-drag'

/** Pixels of pointer travel before we lock an axis. Matches dnd-kit's default. */
const AXIS_LOCK_THRESHOLD = 4

interface UseFillDragOptions {
  tableId: string
  enabled: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  indexer: CellIndexer
  config?: CellSelectionConfig
}

interface LocalDragState {
  startX: number
  startY: number
  axis: 'vertical' | 'horizontal' | null
  source: CellRange
}

/**
 * Resolve the cell ids under a pointer position. Walks up from
 * elementFromPoint to find the nearest [data-row-id][data-column-id].
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
 * Excel-style fill handle drag.
 *
 *  1. Pointer-down on the handle snapshots the active range as `source`.
 *  2. Once the pointer has traveled ≥4px, the dominant axis locks
 *     (vertical or horizontal) for the rest of the drag.
 *  3. Each pointermove updates `fillDrag.preview` — the source rect extended
 *     along the locked axis toward the cell under the pointer (positive
 *     direction only for v1: only drag down or right).
 *  4. On pointerup, target cells (preview \ source) are tile-filled from
 *     source values via `coerceForPaste` + `config.saveCells`, and the
 *     active range expands to cover `preview`.
 *  5. Escape aborts: fillDrag clears, no writes.
 */
export function useFillDrag({
  tableId,
  enabled,
  scrollContainerRef,
  indexer,
  config,
}: UseFillDragOptions) {
  const indexerRef = useRef(indexer)
  indexerRef.current = indexer

  const configRef = useRef(config)
  configRef.current = config

  const localRef = useRef<LocalDragState | null>(null)

  const { begin } = usePointerDrag({ enabled, scrollContainerRef })

  /** Compute the preview range given the current pointer position and locked axis. */
  const computePreview = useCallback((x: number, y: number): CellRange | null => {
    const local = localRef.current
    if (!local || !local.axis) return null

    const idx = indexerRef.current
    const ids = findCellIdsAtPoint(x, y)
    const bounds = rangeBounds(local.source)

    let targetRowIdx = bounds.bottom
    let targetColIdx = bounds.right

    if (ids) {
      const r = idx.rowIdToIndex.get(ids.rowId)
      const c = idx.columnIdToIndex.get(ids.columnId)
      if (r !== undefined) targetRowIdx = r
      if (c !== undefined) targetColIdx = c
    }

    // Clip to table bounds
    const maxRow = idx.rowIds.length - 1
    const maxCol = idx.columnIds.length - 1

    // Extension in either direction along the locked axis: if the pointer
    // is beyond the source's far edge, extend forward; if before the near
    // edge, extend backward. Inside the source = no extension.
    let previewTop = bounds.top
    let previewLeft = bounds.left
    let previewBottom = bounds.bottom
    let previewRight = bounds.right

    if (local.axis === 'vertical') {
      if (targetRowIdx > bounds.bottom) {
        previewBottom = Math.min(targetRowIdx, maxRow)
      } else if (targetRowIdx < bounds.top) {
        previewTop = Math.max(targetRowIdx, 0)
      }
    } else {
      if (targetColIdx > bounds.right) {
        previewRight = Math.min(targetColIdx, maxCol)
      } else if (targetColIdx < bounds.left) {
        previewLeft = Math.max(targetColIdx, 0)
      }
    }

    const topRowId = idx.rowIds[previewTop]
    const bottomRowId = idx.rowIds[previewBottom]
    const leftColId = idx.columnIds[previewLeft]
    const rightColId = idx.columnIds[previewRight]
    if (!topRowId || !bottomRowId || !leftColId || !rightColId) return null

    const anchor: RangeEndpoint = {
      rowId: topRowId,
      columnId: leftColId,
      rowIndex: previewTop,
      colIndex: previewLeft,
    }
    const focus: RangeEndpoint = {
      rowId: bottomRowId,
      columnId: rightColId,
      rowIndex: previewBottom,
      colIndex: previewRight,
    }
    return { anchor, focus }
  }, [])

  /** Commit the fill: tile source into preview-minus-source, dispatch saveCells. */
  const commitFill = useCallback(
    async (preview: CellRange, source: CellRange) => {
      const cfg = configRef.current
      if (!cfg?.saveCells) return

      const idx = indexerRef.current
      const previewB = rangeBounds(preview)
      const sourceB = rangeBounds(source)
      const sourceRows = sourceB.bottom - sourceB.top + 1
      const sourceCols = sourceB.right - sourceB.left + 1

      // Build source payload grid (row-major, indexed by offset within source).
      const sourcePayloads: (CopyCellPayload | null)[][] = []
      for (let r = 0; r < sourceRows; r++) {
        const rowArr: (CopyCellPayload | null)[] = []
        const rowId = idx.rowIds[sourceB.top + r]
        for (let c = 0; c < sourceCols; c++) {
          const colId = idx.columnIds[sourceB.left + c]
          if (!rowId || !colId) {
            rowArr.push(null)
            continue
          }
          let payload: CopyCellPayload | null | undefined
          try {
            payload = cfg.formatCellForCopy?.(rowId, colId)
          } catch {
            payload = null
          }
          if (!payload) {
            const raw = cfg.getCellValue?.(rowId, colId)
            payload = {
              display: raw === null || raw === undefined ? '' : String(raw),
              raw,
            }
          }
          rowArr.push(payload)
        }
        sourcePayloads.push(rowArr)
      }

      const updates: Array<{ rowId: string; columnId: string; value: unknown }> = []
      const reasons = new Map<CoerceReason, number>()
      const bump = (r: CoerceReason) => reasons.set(r, (reasons.get(r) ?? 0) + 1)
      let skipped = 0

      for (let r = previewB.top; r <= previewB.bottom; r++) {
        for (let c = previewB.left; c <= previewB.right; c++) {
          // Skip cells already in the source — we only write to the extension.
          const inSource =
            r >= sourceB.top && r <= sourceB.bottom && c >= sourceB.left && c <= sourceB.right
          if (inSource) continue

          const targetRowId = idx.rowIds[r]
          const targetColId = idx.columnIds[c]
          if (!targetRowId || !targetColId) continue

          // Tile: source offset by modulo distance from source origin.
          const relR = (((r - sourceB.top) % sourceRows) + sourceRows) % sourceRows
          const relC = (((c - sourceB.left) % sourceCols) + sourceCols) % sourceCols
          const source = sourcePayloads[relR]?.[relC]
          if (!source) continue

          const field = cfg.getFieldDefinition?.(targetColId)
          if (!field) {
            skipped++
            continue
          }

          const result = coerceForPaste(source, field, {
            columnId: targetColId,
            resolveRelationshipByDisplay: cfg.resolveRelationshipByDisplay,
            resolveActorByDisplay: cfg.resolveActorByDisplay,
          })
          if (result.ok) {
            updates.push({ rowId: targetRowId, columnId: targetColId, value: result.value })
          } else {
            skipped++
            bump(result.reason)
          }
        }
      }

      if (updates.length > 0) {
        try {
          const saveResult = await cfg.saveCells(updates)
          if (saveResult.skipped > 0) {
            skipped += saveResult.skipped
            bump('read-only')
          }
        } catch (err) {
          toastError({
            title: 'Error filling cells',
            description: err instanceof Error ? err.message : 'Could not fill selected cells',
          })
          return
        }
      }

      // Expand the active range to cover the preview rectangle (Excel behavior).
      const topRowId = idx.rowIds[previewB.top]
      const bottomRowId = idx.rowIds[previewB.bottom]
      const leftColId = idx.columnIds[previewB.left]
      const rightColId = idx.columnIds[previewB.right]
      if (topRowId && bottomRowId && leftColId && rightColId) {
        useSelectionStore.getState().setRange(tableId, {
          anchor: {
            rowId: topRowId,
            columnId: leftColId,
            rowIndex: previewB.top,
            colIndex: previewB.left,
          },
          focus: {
            rowId: bottomRowId,
            columnId: rightColId,
            rowIndex: previewB.bottom,
            colIndex: previewB.right,
          },
        })
      }

      if (skipped > 0) {
        const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]
        const topReason = top ? reasonToLabel(top[0]) : 'unknown'
        toastError({
          title: `${skipped} cell${skipped === 1 ? '' : 's'} skipped`,
          description: `Most common reason: ${topReason}`,
        })
      }
    },
    [tableId]
  )

  const beginFillDrag = useCallback(
    (pointerId: number, pointerX: number, pointerY: number) => {
      const store = useSelectionStore.getState()
      const source = store.getRange(tableId)
      if (!source) return

      // Snapshot source + reset local state.
      localRef.current = {
        startX: pointerX,
        startY: pointerY,
        axis: null,
        source,
      }
      // Clear any stale fill-drag state; preview appears once axis locks.
      store.setFillDrag(tableId, null)

      const onMove = (x: number, y: number) => {
        const local = localRef.current
        if (!local) return

        // Lock axis once the pointer has moved beyond the threshold.
        if (!local.axis) {
          const dx = Math.abs(x - local.startX)
          const dy = Math.abs(y - local.startY)
          if (Math.max(dx, dy) < AXIS_LOCK_THRESHOLD) return
          local.axis = dy >= dx ? 'vertical' : 'horizontal'
        }

        const preview = computePreview(x, y)
        if (!preview) return

        const current = useSelectionStore.getState().getFillDrag(tableId)
        // Cheap dedupe: skip when preview shape hasn't changed.
        if (
          current &&
          current.axis === local.axis &&
          current.preview.anchor.rowIndex === preview.anchor.rowIndex &&
          current.preview.anchor.colIndex === preview.anchor.colIndex &&
          current.preview.focus.rowIndex === preview.focus.rowIndex &&
          current.preview.focus.colIndex === preview.focus.colIndex
        ) {
          return
        }

        useSelectionStore
          .getState()
          .setFillDrag(tableId, { source: local.source, preview, axis: local.axis })
      }

      const onEnd = () => {
        const local = localRef.current
        const fillDrag = useSelectionStore.getState().getFillDrag(tableId)
        useSelectionStore.getState().setFillDrag(tableId, null)
        localRef.current = null

        // Commit only if we actually previewed something past the source.
        if (!local || !local.axis || !fillDrag) return
        const previewB = rangeBounds(fillDrag.preview)
        const sourceB = rangeBounds(fillDrag.source)
        const extended =
          previewB.bottom > sourceB.bottom ||
          previewB.right > sourceB.right ||
          previewB.top < sourceB.top ||
          previewB.left < sourceB.left
        if (!extended) return

        void commitFill(fillDrag.preview, fillDrag.source)
      }

      const onEscape = () => {
        useSelectionStore.getState().setFillDrag(tableId, null)
        localRef.current = null
      }

      begin({
        pointerId,
        pointerX,
        pointerY,
        cursor: 'crosshair',
        onMove,
        onEnd,
        onEscape,
      })
    },
    [tableId, begin, computePreview, commitFill]
  )

  return { beginFillDrag }
}
