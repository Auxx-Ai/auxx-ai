// apps/web/src/components/accounting/ui/reports/report-grid-layout.ts

import type { ReactNode } from 'react'
import type { StatementRow } from './statement-parts'

/** A statement row, plus what only the report grid renders. */
export interface ReportGridRow extends Omit<StatementRow, 'children'> {
  /** Text cells, keyed by `ReportTextColumn.key`. */
  cells?: Record<string, ReactNode>
  /** A row whose data is still loading: drawn as a skeleton at its final height. */
  loading?: boolean
  children?: ReportGridRow[]
}

/** One row as the grid places it. */
export interface ReportGridItem {
  row: ReportGridRow
  depth: number
  hasChildren: boolean
  isOpen: boolean
  /** Top of the row's slot, from the top of the row body. */
  offset: number
  /** The whole slot: top gap + margin + the row line. */
  height: number
  /** Space above the row line inside the slot. */
  top: number
  /** The row line itself. */
  lineHeight: number
}

export interface ReportGridLayout {
  items: ReportGridItem[]
  total: number
  offsetById: Map<string, number>
}

/** `TreeRow`'s line: `py-1.5` around a 20px `text-sm` line. */
const LINE_HEIGHT = 32
/** `StatementTable`'s `gap-0.5` between top-level rows. */
const ROOT_GAP = 2

/**
 * Heights mirror `StatementTable`: subtotal and total rows carry `mt-0.5` and a
 * 1px / 2px top border; nested rows sit flush, top-level rows 2px apart.
 */
function kindExtras(kind: StatementRow['kind']): { margin: number; border: number } {
  if (kind === 'subtotal') return { margin: 2, border: 1 }
  if (kind === 'total') return { margin: 2, border: 2 }
  return { margin: 0, border: 0 }
}

/** Flatten the open part of the tree into positioned rows. */
export function layoutReportRows(
  rows: readonly ReportGridRow[],
  isOpen: (row: ReportGridRow) => boolean
): ReportGridLayout {
  const items: ReportGridItem[] = []
  const offsetById = new Map<string, number>()
  let offset = 0

  const visit = (row: ReportGridRow, depth: number, gapBefore: number) => {
    const hasChildren = !!row.children && row.children.length > 0
    const open = hasChildren && isOpen(row)
    const { margin, border } = kindExtras(row.kind)
    const top = gapBefore + margin
    const lineHeight = LINE_HEIGHT + border
    const height = top + lineHeight
    items.push({ row, depth, hasChildren, isOpen: open, offset, height, top, lineHeight })
    offsetById.set(row.id, offset)
    offset += height
    if (open) {
      for (const child of row.children ?? []) visit(child, Math.max(child.depth, depth + 1), 0)
    }
  }

  rows.forEach((row, index) => visit(row, row.depth, index === 0 ? 0 : ROOT_GAP))
  return { items, total: offset, offsetById }
}

/** Index range `[start, end)` of the items overlapping `[top, bottom]`. */
export function visibleRange(
  items: readonly ReportGridItem[],
  top: number,
  bottom: number
): [number, number] {
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = (low + high) >> 1
    const item = items[mid] as ReportGridItem
    if (item.offset + item.height <= top) low = mid + 1
    else high = mid
  }
  let end = low
  while (end < items.length && (items[end] as ReportGridItem).offset < bottom) end += 1
  return [low, end]
}
