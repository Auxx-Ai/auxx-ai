// apps/web/src/components/dashboard/ui/dashboard-grid.tsx
'use client'

// The responsive drag/resize widget grid. Wraps react-grid-layout v2's
// `ResponsiveGridLayout` (which auto-selects a breakpoint from the measured
// container width — v2 dropped the `WidthProvider` HOC, so we measure the
// container ourselves with the `useContainerWidth` hook) and gates all
// interaction behind `isEditMode`. Deliberately prop-driven, not store-coupled:
// it converts widgets ↔ LayoutItem[] via `grid-convert`, diffs drag/resize
// commits, and hands the caller only the widgets that moved (`onLayoutCommit`)
// plus the active-drag id (`onDragStateChange`). Plan 08 wires those to the
// draft store (`applyGridLayout` / `draggingWidgetId`); plan 05 supplies
// `renderWidget`.
//
// Edit-mode also renders a Twenty-style empty-cell overlay (`onAddWidgetAt`): a
// CSS grid mirroring the RGL geometry (12 cols, `rowHeight` rows, `margin` gap)
// painted BEHIND the grid items, so occupied cells are covered by widgets and
// only the empty holes stay clickable. Clicking a cell anchors a kind-picker
// popover there; the picked kind + cell are handed back to `onAddWidgetAt`.

import type { LayoutWidget, WidgetKind } from '@auxx/lib/dashboards/client'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { type ReactNode, useState } from 'react'
import {
  type Layout,
  type LayoutItem,
  ResponsiveGridLayout,
  type ResponsiveLayouts,
  useContainerWidth,
  verticalCompactor,
} from 'react-grid-layout'
import { GRID_BREAKPOINTS, GRID_COLUMNS, GRID_MARGIN, GRID_ROW_HEIGHT } from '../lib/grid-constants'
import { applyLayoutToWidgets, tabToLayouts } from '../lib/grid-convert'
import { CHART_KINDS, CONTENT_KINDS, type WidgetKindMeta } from './config/add-widget-menu'
import './dashboard-grid.css'

type DashboardGridProps = {
  widgets: LayoutWidget[]
  isEditMode: boolean
  /** Called with ONLY the widgets whose position changed on a drag/resize commit. */
  onLayoutCommit: (
    changes: Array<{ id: string; gridPosition: LayoutWidget['gridPosition'] }>
  ) => void
  /** Fires the dragged widget's id on drag start, `null` on stop. */
  onDragStateChange?: (draggingWidgetId: string | null) => void
  /** Renders a single widget's body (plan 05's `DashboardWidget`). */
  renderWidget: (widget: LayoutWidget) => ReactNode
  /**
   * Edit-mode only: called with the chosen widget kind + the clicked empty grid
   * cell (x=column, y=row) when the caller wants a Twenty-style "click an empty
   * cell to add a widget" overlay. Omitted → no overlay is rendered. The grid
   * owns the cell overlay + the kind-picker popover; the caller only performs
   * the add (e.g. `addWidget(tabId, kind, position)`).
   */
  onAddWidgetAt?: (kind: WidgetKind, position: { x: number; y: number }) => void
  className?: string
}

/** Empty rows kept clickable below the content so there's always room to add. */
const EMPTY_ROW_BUFFER = 4

/** Charts + Content, flattened for the cell popover's kind list. */
const CELL_KIND_GROUPS: Array<{ label: string; kinds: WidgetKindMeta[] }> = [
  { label: 'Charts', kinds: CHART_KINDS },
  { label: 'Content', kinds: CONTENT_KINDS },
]

export function DashboardGrid({
  widgets,
  isEditMode,
  onLayoutCommit,
  onDragStateChange,
  renderWidget,
  onAddWidgetAt,
  className,
}: DashboardGridProps) {
  // v2 has no WidthProvider: ResponsiveGridLayout needs an explicit pixel width
  // to pick a breakpoint. `useContainerWidth` (ResizeObserver) measures the
  // wrapper. `measureBeforeMount` holds the grid back until the first real
  // measurement so we never paint the layout at the default width and snap.
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true })

  // The empty cell awaiting a kind pick (drives the anchored popover). `rect` is
  // the cell's box within the grid container, computed from the grid geometry.
  const [pendingCell, setPendingCell] = useState<{
    x: number
    y: number
    rect: { left: number; top: number; width: number; height: number }
  } | null>(null)

  const layouts: ResponsiveLayouts = tabToLayouts(widgets)

  // v2's onLayoutChange is (currentBreakpointLayout, allBreakpointLayouts). Only
  // the desktop breakpoint is persisted — mobile is always derived (plan 08:
  // edit mode is desktop-only). Ignore events entirely in view mode.
  const handleLayoutChange = (_current: Layout, all: ResponsiveLayouts) => {
    if (!isEditMode) return
    const desktop = all.desktop
    if (!desktop) return
    const changes = applyLayoutToWidgets(widgets, desktop)
    if (changes.length > 0) onLayoutCommit(changes)
  }

  const handleDragStart = (
    _layout: Layout,
    _oldItem: LayoutItem | null,
    newItem: LayoutItem | null
  ) => onDragStateChange?.(newItem?.i ?? null)

  // The empty-cell overlay (edit mode only). Rows = content bottom + a buffer so
  // there's always clickable empty space below the widgets. Cols is the desktop
  // count (edit mode is desktop-only). The container gets a matching min-height
  // so those extra rows are actually visible/clickable below the grid content.
  const showCells = isEditMode && !!onAddWidgetAt
  const cols = GRID_COLUMNS.desktop
  const contentBottom = widgets.reduce(
    (max, w) => Math.max(max, w.gridPosition.row + w.gridPosition.rowSpan),
    0
  )
  const rows = contentBottom + EMPTY_ROW_BUFFER
  const cellsMinHeight = rows * GRID_ROW_HEIGHT + (rows - 1) * GRID_MARGIN

  // Cell box within the container, derived from the same geometry RGL uses
  // (containerPadding [0,0], gap = margin). Column width mirrors CSS `1fr`.
  const cellWidth = (width - (cols - 1) * GRID_MARGIN) / cols
  const handleCellClick = (x: number, y: number) => {
    setPendingCell({
      x,
      y,
      rect: {
        left: x * (cellWidth + GRID_MARGIN),
        top: y * (GRID_ROW_HEIGHT + GRID_MARGIN),
        width: cellWidth,
        height: GRID_ROW_HEIGHT,
      },
    })
  }
  const pickKind = (kind: WidgetKind) => {
    if (pendingCell) onAddWidgetAt?.(kind, { x: pendingCell.x, y: pendingCell.y })
    setPendingCell(null)
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'dashboard-grid',
        isEditMode && 'dashboard-grid--edit rounded-lg bg-muted/30',
        className
      )}
      style={showCells ? { minHeight: cellsMinHeight } : undefined}>
      {showCells && (
        <div
          className='dashboard-grid-cells'
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: `${GRID_ROW_HEIGHT}px`,
            gap: `${GRID_MARGIN}px`,
          }}>
          {Array.from({ length: cols * rows }, (_, i) => {
            const x = i % cols
            const y = Math.floor(i / cols)
            return (
              <button
                key={i}
                type='button'
                className='dashboard-grid-cell'
                aria-label='Add widget here'
                onClick={() => handleCellClick(x, y)}
              />
            )
          })}
        </div>
      )}
      {showCells && (
        <Popover open={pendingCell !== null} onOpenChange={(o) => !o && setPendingCell(null)}>
          {pendingCell && (
            <PopoverAnchor asChild>
              <div
                className='pointer-events-none absolute'
                style={{
                  left: pendingCell.rect.left,
                  top: pendingCell.rect.top,
                  width: pendingCell.rect.width,
                  height: pendingCell.rect.height,
                }}
              />
            </PopoverAnchor>
          )}
          <PopoverContent align='start' side='bottom' className='w-64 p-1'>
            {CELL_KIND_GROUPS.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'mt-1 border-t pt-1' : undefined}>
                <div className='px-2 py-1.5 text-xs font-medium text-muted-foreground'>
                  {group.label}
                </div>
                {group.kinds.map((meta) => {
                  const Icon = meta.icon
                  return (
                    <button
                      key={meta.kind}
                      type='button'
                      className='flex w-full items-start gap-2.5 rounded-sm px-2 py-2 text-left hover:bg-accent'
                      onClick={() => pickKind(meta.kind)}>
                      <Icon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                      <div className='flex flex-col'>
                        <span className='text-sm'>{meta.label}</span>
                        <span className='text-xs text-muted-foreground'>{meta.description}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          layouts={layouts}
          breakpoints={GRID_BREAKPOINTS}
          cols={GRID_COLUMNS}
          rowHeight={GRID_ROW_HEIGHT}
          margin={[GRID_MARGIN, GRID_MARGIN]}
          containerPadding={[0, 0]}
          compactor={verticalCompactor}
          dragConfig={{ enabled: isEditMode, handle: '.widget-drag-handle' }}
          resizeConfig={{ enabled: isEditMode, handles: ['se', 'e', 's'] }}
          onDragStart={handleDragStart}
          onDragStop={() => onDragStateChange?.(null)}
          onLayoutChange={handleLayoutChange}>
          {widgets.map((widget) => (
            <div key={widget.id}>{renderWidget(widget)}</div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
