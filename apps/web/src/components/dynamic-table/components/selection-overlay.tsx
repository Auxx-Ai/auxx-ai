// apps/web/src/components/dynamic-table/components/selection-overlay.tsx
'use client'

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTableConfig } from '../context/table-config-context'
import { useSelectionStore } from '../stores/selection-store'
import type { CellRange } from '../types'
import { ROW_HEIGHT } from '../utils/constants'
import { isSingleCell, rangeBounds } from '../utils/range'
import { FillHandle } from './fill-handle'

interface SelectionOverlayProps {
  /** The scroll container that owns the rendered cells. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

interface OverlayRect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Compute the pixel rect for a range within the scroll container.
 * Vertical extent is arithmetic (rowIndex × ROW_HEIGHT) so virtualized rows
 * that aren't mounted still produce a correct rectangle. Horizontal extent
 * reads the DOM (columns are resizable).
 */
function useRangeRect(
  range: CellRange | null,
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
): OverlayRect | null {
  const [rect, setRect] = useState<OverlayRect | null>(null)
  const rafRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!range) {
      setRect(null)
      return
    }
    const container = scrollContainerRef.current
    if (!container) return

    const compute = () => {
      const bounds = rangeBounds(range)

      // Vertical: arithmetic, virtualizer-aware. Rows have `border-y` (1px top
      // + 1px bottom) via border-box, so the cell content area is inset 1px on
      // each end within each ROW_HEIGHT slot. Match that so the range ring
      // aligns with the anchor cell's `.cell-active::after`.
      const top = bounds.top * ROW_HEIGHT + 1
      const height = (bounds.bottom - bounds.top + 1) * ROW_HEIGHT - 2

      // Horizontal: read DOM cell rects for the left/right columns from any
      // mounted row. All columns are always rendered (just scrolled), so we
      // can find one even if the specific row isn't in the DOM.
      const leftColId =
        range.anchor.colIndex <= range.focus.colIndex ? range.anchor.columnId : range.focus.columnId
      const rightColId =
        range.anchor.colIndex >= range.focus.colIndex ? range.anchor.columnId : range.focus.columnId
      const leftCell = container.querySelector(
        `[data-row-id][data-column-id="${CSS.escape(leftColId)}"]`
      ) as HTMLElement | null
      const rightCell = container.querySelector(
        `[data-row-id][data-column-id="${CSS.escape(rightColId)}"]`
      ) as HTMLElement | null
      if (!leftCell || !rightCell) {
        setRect(null)
        return
      }

      const cRect = container.getBoundingClientRect()
      const lRect = leftCell.getBoundingClientRect()
      const rRect = rightCell.getBoundingClientRect()
      const left = lRect.left - cRect.left + container.scrollLeft
      const right = rRect.right - cRect.left + container.scrollLeft
      const width = right - left

      setRect({ top, left, width, height })
    }

    compute()

    const scheduleCompute = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        compute()
      })
    }

    container.addEventListener('scroll', scheduleCompute, { passive: true })
    const ro = new ResizeObserver(scheduleCompute)
    ro.observe(container)

    return () => {
      container.removeEventListener('scroll', scheduleCompute)
      ro.disconnect()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [range, scrollContainerRef])

  // Recompute on window resize too (column widths can shift)
  useEffect(() => {
    const handler = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setRect((prev) => (prev ? { ...prev } : prev))
      })
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return rect
}

function PositionedBox({
  rect,
  className,
  children,
  dataSlot,
}: {
  rect: OverlayRect
  className: string
  children?: ReactNode
  dataSlot: string
}) {
  return (
    <div
      data-slot={dataSlot}
      className={className}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}>
      {children}
    </div>
  )
}

/**
 * Renders:
 *  1. The active-range rectangle (blue border + tint). Even at 1×1 we
 *     render an invisible box to position the fill handle.
 *  2. The fill-handle drag preview (dashed border), if active.
 */
export function SelectionOverlay({ scrollContainerRef }: SelectionOverlayProps) {
  const { tableId } = useTableConfig()
  const range = useSelectionStore((s) => s.tables[tableId]?.range ?? null)
  const fillDrag = useSelectionStore((s) => s.tables[tableId]?.fillDrag ?? null)
  const isEditing = useSelectionStore((s) => s.tables[tableId]?.editingCell != null)

  const rangeRect = useRangeRect(range, scrollContainerRef)
  const previewRect = useRangeRect(fillDrag?.preview ?? null, scrollContainerRef)

  const single = range ? isSingleCell(range) : false

  if (!rangeRect) return null

  // 1×1 selection: overlay itself is invisible (the cell's `.cell-active`
  // affordance owns the visual). Hide the border/tint while fill-dragging
  // too — the dashed preview takes over the visual narrative.
  const overlayClassName =
    single || fillDrag
      ? 'absolute pointer-events-none z-20'
      : 'absolute pointer-events-none rounded-md bg-info/5 z-20 before:content-[""] before:absolute before:inset-0 before:rounded-md before:pointer-events-none before:ring-1 before:ring-inset before:ring-info/50'

  return (
    <>
      <PositionedBox rect={rangeRect} className={overlayClassName} dataSlot='selection-overlay'>
        {/* Single-cell case is owned by ExpandableCell so the handle follows
            an expanded cell's actual right edge instead of the cell rect. */}
        {!isEditing && !fillDrag && !single && <FillHandle />}
      </PositionedBox>

      {previewRect && (
        <PositionedBox
          rect={previewRect}
          className='absolute pointer-events-none border-2 border-dashed border-blue-500 z-30'
          dataSlot='fill-preview-overlay'
        />
      )}
    </>
  )
}
