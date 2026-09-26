// apps/web/src/components/mrp/ui/all-parts/all-parts-rows.tsx

import {
  MRP_SUGGESTION_KIND_LABELS,
  MRP_SUPPLY_TYPE_LABELS,
  type MrpLeadTimeSource,
} from '@auxx/lib/mrp/client'
import type { ReactNode } from 'react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import type { ReportTextColumn } from '~/components/global/report-grid/report-grid'
import type { ReportGridRow } from '~/components/global/report-grid/report-grid-layout'
import { flagLabel, formatOrderBy, formatQty, stockStatusDisplay } from '../rows/format'
import type { MrpListRow } from '../rows/mrp-row'

/** Every column is a run output (07 D36); the part itself is the grid's label column. */
export const ALL_PARTS_COLUMNS: ReportTextColumn[] = [
  { key: 'sku', label: 'SKU', width: 120 },
  { key: 'status', label: 'Status', width: 110 },
  { key: 'supplyType', label: 'Supply', width: 104 },
  { key: 'buffered', label: 'Buffered', width: 80 },
  { key: 'onHand', label: 'On hand', width: 88, align: 'right' },
  { key: 'onOrder', label: 'On order', width: 88, align: 'right' },
  { key: 'netFlow', label: 'Net flow', width: 88, align: 'right' },
  { key: 'adu', label: 'Avg daily use', width: 108, align: 'right' },
  { key: 'cover', label: 'Days of cover', width: 108, align: 'right' },
  { key: 'leadTime', label: 'Lead time', width: 120 },
  { key: 'stockout', label: 'Stockout', width: 96 },
  { key: 'orderBy', label: 'Order by', width: 96 },
  { key: 'suggestion', label: 'Suggestion', width: 140 },
  { key: 'supplier', label: 'Supplier', minWidth: 160 },
  { key: 'flags', label: 'Flags', width: 200 },
]

const LEAD_TIME_SOURCE_LABEL: Record<MrpLeadTimeSource, string | null> = {
  vendor: 'vendor',
  build: 'build',
  none: null,
}

function figure(value: string | null): ReactNode {
  return value === null ? (
    <span className='text-muted-foreground'>{EMPTY_CELL}</span>
  ) : (
    <span className='font-mono text-xs tabular-nums'>{value}</span>
  )
}

function qty(value: number | null): ReactNode {
  return figure(value === null ? null : formatQty(value))
}

/** One run item as a flat grid line, keyed by part id. */
export function toAllPartsRow(item: MrpListRow, today: Date): ReportGridRow {
  const status = stockStatusDisplay(item.stockStatus)
  const source = LEAD_TIME_SOURCE_LABEL[item.leadTimeSource]
  const overdue = !!item.orderByDate && item.isOverdue
  return {
    id: item.partId,
    label: item.partName ?? 'Unnamed part',
    depth: 0,
    kind: 'line',
    values: [],
    cells: {
      sku: item.partSku ?? '',
      status: status ? (
        <span className='inline-flex items-center gap-1.5'>
          <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      ) : (
        EMPTY_CELL
      ),
      supplyType: MRP_SUPPLY_TYPE_LABELS[item.supplyType],
      buffered: item.buffered ? 'Yes' : 'No',
      onHand: qty(item.onHand),
      onOrder: qty(item.onOrder),
      netFlow: qty(item.netFlow),
      adu: qty(item.adu),
      cover: figure(item.daysOfCover === null ? null : `${item.daysOfCover} d`),
      leadTime:
        item.leadTimeDays === null ? (
          EMPTY_CELL
        ) : (
          <span>
            <span className='font-mono text-xs tabular-nums'>{formatQty(item.leadTimeDays)} d</span>
            {source && <span className='text-muted-foreground'> · {source}</span>}
          </span>
        ),
      stockout: item.stockoutDate ? formatOrderBy(item.stockoutDate, today) : EMPTY_CELL,
      orderBy: item.orderByDate ? (
        <span className={overdue ? 'text-destructive' : undefined}>
          {formatOrderBy(item.orderByDate, today)}
        </span>
      ) : (
        EMPTY_CELL
      ),
      suggestion:
        item.suggestionKind && item.suggestedQty !== null ? (
          <span>
            {MRP_SUGGESTION_KIND_LABELS[item.suggestionKind]}{' '}
            <span className='font-mono text-xs tabular-nums'>{formatQty(item.suggestedQty)}</span>
          </span>
        ) : (
          EMPTY_CELL
        ),
      supplier: item.supplierName ?? '',
      flags: item.flags.length ? item.flags.map(flagLabel).join(', ') : '',
    },
  }
}

/** Skeleton lines at row height while the first page loads. */
export const LOADING_ROWS: ReportGridRow[] = Array.from({ length: 12 }, (_, index) => ({
  id: `loading:${index}`,
  label: '',
  depth: 0,
  kind: 'line',
  values: [],
  loading: true,
}))

export const NO_FINISHED_GOOD_ID = 'no-finished-good'

export interface AllPartsRows {
  rows: ReportGridRow[]
  /** Grid row id → part id, for the rows that open a part; ids repeat parts across sections. */
  partIdByRowId: Map<string, string>
  sectionIds: string[]
}

/** Flat lines, one per item. */
export function flatAllParts(items: readonly MrpListRow[], today: Date): AllPartsRows {
  const partIdByRowId = new Map<string, string>()
  const rows = items.map((item) => {
    partIdByRowId.set(item.partId, item.partId)
    return toAllPartsRow(item, today)
  })
  return { rows, partIdByRowId, sectionIds: [] }
}

/**
 * One section per finished good, headed by its own item when loaded, in order of first
 * appearance so the list's sort carries over; a part under several finished goods repeats.
 */
export function groupAllPartsByFinishedGood(
  items: readonly MrpListRow[],
  today: Date,
  /** Where section heads are looked up; the unfiltered list while searching. */
  heads: readonly MrpListRow[] = items
): AllPartsRows {
  const byPartId = new Map(heads.map((item) => [item.partId, item]))
  const sections = new Map<string, { name: string; children: MrpListRow[] }>()
  const loose: MrpListRow[] = []

  for (const item of items) {
    if (item.finishedGoodIds.length === 0) {
      loose.push(item)
      continue
    }
    item.finishedGoodIds.forEach((finishedGoodId, index) => {
      let section = sections.get(finishedGoodId)
      if (!section) {
        section = { name: item.finishedGoodNames[index] ?? 'Unnamed part', children: [] }
        sections.set(finishedGoodId, section)
      }
      // A sold finished good lists itself; it is the section head, not a line under it.
      if (finishedGoodId !== item.partId) section.children.push(item)
    })
  }

  const partIdByRowId = new Map<string, string>()
  const line = (sectionId: string, item: MrpListRow): ReportGridRow => {
    const id = `${sectionId}/${item.partId}`
    partIdByRowId.set(id, item.partId)
    return { ...toAllPartsRow(item, today), id, depth: 1 }
  }

  const rows: ReportGridRow[] = [...sections].map(([finishedGoodId, section]) => {
    const own = byPartId.get(finishedGoodId)
    if (own) partIdByRowId.set(finishedGoodId, finishedGoodId)
    const head: ReportGridRow = own
      ? toAllPartsRow(own, today)
      : { id: finishedGoodId, label: section.name, depth: 0, kind: 'line', values: [] }
    return {
      ...head,
      kind: 'section',
      children: section.children.map((item) => line(finishedGoodId, item)),
    }
  })

  const rest = loose.filter((item) => !sections.has(item.partId))
  if (rest.length)
    rows.push({
      id: NO_FINISHED_GOOD_ID,
      label: 'No finished good',
      depth: 0,
      kind: 'section',
      values: [],
      children: rest.map((item) => line(NO_FINISHED_GOOD_ID, item)),
    })

  return { rows, partIdByRowId, sectionIds: rows.map((row) => row.id) }
}
