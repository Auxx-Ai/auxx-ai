// apps/web/src/components/dynamic-table/utils/build-virtual-items.ts

import { EMPTY_GROUP_KEY } from '@auxx/lib/resources/grouping/client'
import type { GroupingProps } from '../types'
import { ADD_ROW_HEIGHT, GROUP_HEADER_HEIGHT, ROW_HEIGHT } from './constants'

/** One virtualized line of the table body. `id` is unique and stable (the virtualizer key). */
export type TableVirtualItem =
  | { kind: 'header'; id: string; key: string | null; firstRowIndex: number }
  | { kind: 'row'; id: string; rowIndex: number }
  | { kind: 'add'; id: string; key: string | null }

export interface VirtualItemsResult {
  items: TableVirtualItem[]
  /** Pixel top of each `rows[i]`, relative to the body container. */
  rowTops: number[]
}

type GroupingInput = Pick<GroupingProps, 'keyForRow' | 'orderedKeys' | 'collapsedKeys'>

/** Pixel height of one virtual item. */
export function virtualItemSize(item: TableVirtualItem): number {
  if (item.kind === 'header') return GROUP_HEADER_HEIGHT
  if (item.kind === 'add') return ADD_ROW_HEIGHT
  return ROW_HEIGHT
}

function toStringKey(key: string | null): string {
  return key ?? EMPTY_GROUP_KEY
}

function fromStringKey(key: string): string | null {
  return key === EMPTY_GROUP_KEY ? null : key
}

/**
 * Flatten `rows` into header / row / add items (plans/table/group-by-plan.md §5.2).
 * Rows arrive contiguous by group from the server; a header is emitted on every key change.
 */
export function buildVirtualItems(
  rows: ReadonlyArray<{ id: string }>,
  grouping: GroupingInput | undefined,
  options: { addRow: boolean }
): VirtualItemsResult {
  if (!grouping) {
    return {
      items: rows.map((row, rowIndex) => ({ kind: 'row', id: row.id, rowIndex })),
      rowTops: rows.map((_, rowIndex) => rowIndex * ROW_HEIGHT),
    }
  }

  const { keyForRow, orderedKeys, collapsedKeys } = grouping

  // Contiguous runs of rows sharing a key, in server order.
  const segments: Array<{ key: string | null; start: number; end: number }> = []
  rows.forEach((row, index) => {
    const key = keyForRow(row.id)
    const last = segments[segments.length - 1]
    if (last && last.key === key) last.end = index
    else segments.push({ key, start: index, end: index })
  })

  const loaded = new Set(segments.map((segment) => toStringKey(segment.key)))

  // Collapsed groups have no loaded rows (excluded server-side) but still need a header.
  let pendingCollapsed: Array<string | null>
  let orderIndex: Map<string, number> | null = null
  if (orderedKeys) {
    orderIndex = new Map(orderedKeys.map((key, index) => [toStringKey(key), index]))
    pendingCollapsed = orderedKeys.filter((key) => {
      const k = toStringKey(key)
      return collapsedKeys.has(k) && !loaded.has(k)
    })
  } else {
    const extra = [...collapsedKeys].filter((k) => !loaded.has(k))
    extra.sort((a, b) => Number(a === EMPTY_GROUP_KEY) - Number(b === EMPTY_GROUP_KEY))
    pendingCollapsed = extra.map(fromStringKey)
  }

  const items: TableVirtualItem[] = []
  const rowTops: number[] = new Array(rows.length)
  const headerCounts = new Map<string, number>()
  let top = 0

  const pushHeader = (key: string | null, firstRowIndex: number) => {
    const k = toStringKey(key)
    const seen = headerCounts.get(k) ?? 0
    headerCounts.set(k, seen + 1)
    // A repeated key (e.g. a just-created row appended out of order) needs a distinct id.
    const suffix = seen === 0 ? '' : `#${seen}`
    items.push({ kind: 'header', id: `header:${k}${suffix}`, key, firstRowIndex })
    top += GROUP_HEADER_HEIGHT
    return suffix
  }

  const flushCollapsedBefore = (limit: number) => {
    while (pendingCollapsed.length > 0) {
      const next = pendingCollapsed[0]!
      const index = orderIndex?.get(toStringKey(next)) ?? Number.POSITIVE_INFINITY
      if (index >= limit) break
      pendingCollapsed.shift()
      pushHeader(next, -1)
    }
  }

  for (const segment of segments) {
    const segmentIndex = orderIndex?.get(toStringKey(segment.key))
    if (segmentIndex !== undefined) flushCollapsedBefore(segmentIndex)

    const headerTop = top
    const suffix = pushHeader(segment.key, segment.start)

    // Rows of a group collapsed while its rows are still loaded stay hidden until the refetch lands.
    if (collapsedKeys.has(toStringKey(segment.key))) {
      for (let i = segment.start; i <= segment.end; i++) rowTops[i] = headerTop
      continue
    }

    for (let i = segment.start; i <= segment.end; i++) {
      items.push({ kind: 'row', id: rows[i]!.id, rowIndex: i })
      rowTops[i] = top
      top += ROW_HEIGHT
    }

    if (options.addRow) {
      items.push({ kind: 'add', id: `add:${toStringKey(segment.key)}${suffix}`, key: segment.key })
      top += ADD_ROW_HEIGHT
    }
  }

  for (const key of pendingCollapsed) pushHeader(key, -1)

  return { items, rowTops }
}
