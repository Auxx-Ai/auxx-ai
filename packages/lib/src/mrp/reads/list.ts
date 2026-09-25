// packages/lib/src/mrp/reads/list.ts

import { type Database, schema } from '@auxx/database'
import { type DayKey, daysBetween } from '@auxx/utils/calendar-day'
import { and, arrayOverlaps, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { optionalFieldId, systemFieldMap, systemValueJoin } from '../../resources/system-records'
import type { MrpFlag, MrpOrderMode, MrpSuggestionKind, MrpSupplyType } from '../client'
import { guard } from './guard'
import { PART_LABEL_PICK } from './labels'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'
import { orderByHorizons } from './summary'

const I = schema.MrpPlanRunItem

/** The action list's status tabs (07 §4.1); `all` is the all-parts grid. */
export const MRP_PLAN_TABS = ['all', 'overdue', 'this_week', 'later', 'flagged', 'fine'] as const
export type MrpPlanTab = (typeof MRP_PLAN_TABS)[number]

export const MRP_LIST_SORTS = ['priority', 'orderByDate', 'stockoutDate', 'partName'] as const
export type MrpListSort = (typeof MRP_LIST_SORTS)[number]

export interface MrpListInput {
  runId?: string | null
  tab?: MrpPlanTab
  supplyType?: MrpSupplyType[]
  suggestionKind?: MrpSuggestionKind[]
  orderMode?: MrpOrderMode[]
  buffered?: boolean
  /** Items carrying any of these flags. */
  flags?: MrpFlag[]
  /** `suggestedSupplierId` in these. */
  supplierIds?: string[]
  /** Part name or SKU, substring. */
  search?: string
  sort?: MrpListSort
  direction?: 'asc' | 'desc'
  limit?: number
  /** Offset of the page, as returned in `nextCursor`. */
  cursor?: number
}

export interface MrpListItem extends MrpPlanItemRow {
  partName: string | null
  partSku: string | null
  stockStatus: string | null
  supplierName: string | null
  /** Stockout date − the run's day; null without a stockout. */
  daysOfCover: number | null
}

export interface MrpList {
  run: MrpRunRef | null
  items: MrpListItem[]
  nextCursor: number | null
}

const DEFAULT_LIMIT = 100

/** The run-relative predicate behind each tab; mirrors the counts in `readSummary`. */
export function tabCondition(tab: MrpPlanTab, asOfDay: DayKey): SQL | undefined {
  const { week } = orderByHorizons(asOfDay)
  switch (tab) {
    case 'overdue':
      return sql`${I.isOverdue}`
    case 'this_week':
      return sql`not ${I.isOverdue} and ${I.orderByDate} <= ${week}`
    case 'later':
      return sql`not ${I.isOverdue} and ${I.orderByDate} > ${week}`
    case 'flagged':
      return sql`cardinality(${I.flags}) > 0`
    case 'fine':
      return sql`${I.suggestionKind} is null and cardinality(${I.flags}) = 0`
    default:
      return undefined
  }
}

/** `%term%` with LIKE metacharacters escaped. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Nulls always last, whichever direction; ties broken by part id so pages are stable. */
function orderColumns(sort: MrpListSort, direction: 'asc' | 'desc', partName: SQL | unknown) {
  const dir = direction === 'desc' ? sql`desc` : sql`asc`
  const by = (col: unknown) => sql`${col} ${dir} nulls last`
  switch (sort) {
    case 'orderByDate':
      return [by(I.orderByDate), by(I.priority), sql`${I.partId} asc`]
    case 'stockoutDate':
      return [by(I.stockoutDate), by(I.priority), sql`${I.partId} asc`]
    case 'partName':
      return [by(partName), sql`${I.partId} asc`]
    default:
      return [by(I.priority), by(I.orderByDate), sql`${I.partId} asc`]
  }
}

/** The action list / all-parts grid: one run's items, filtered and sorted in SQL, with part and supplier labels. */
export async function listPlanItems(
  db: Database,
  organizationId: string,
  input: MrpListInput = {}
): Promise<Result<MrpList, Error>> {
  return guard(
    async () => {
      const run = await loadRun(db, organizationId, input.runId)
      if (!run) return { run: null, items: [], nextCursor: null }

      const fields = await systemFieldMap(db, organizationId, PART_LABEL_PICK)
      const part = alias(schema.EntityInstance, 'mrp_part')
      const supplier = alias(schema.EntityInstance, 'mrp_supplier')
      const sku = alias(schema.FieldValue, 'mrp_part_sku_v')
      const status = alias(schema.FieldValue, 'mrp_part_status_v')

      const search = input.search?.trim()
      const where = and(
        eq(I.organizationId, organizationId),
        eq(I.mrpPlanRunId, run.id),
        input.tab ? tabCondition(input.tab, run.asOfDay) : undefined,
        input.supplyType?.length ? inArray(I.supplyType, input.supplyType) : undefined,
        input.suggestionKind?.length ? inArray(I.suggestionKind, input.suggestionKind) : undefined,
        input.orderMode?.length ? inArray(I.orderMode, input.orderMode) : undefined,
        input.buffered === undefined ? undefined : eq(I.buffered, input.buffered),
        input.flags?.length ? arrayOverlaps(I.flags, input.flags) : undefined,
        input.supplierIds?.length ? inArray(I.suggestedSupplierId, input.supplierIds) : undefined,
        search
          ? or(
              ilike(part.displayName, likePattern(search)),
              ilike(sku.valueText, likePattern(search))
            )
          : undefined
      )

      const limit = input.limit ?? DEFAULT_LIMIT
      const offset = input.cursor ?? 0
      const rows = await db
        .select({
          item: I,
          partName: part.displayName,
          partSku: sku.valueText,
          stockStatus: status.optionId,
          supplierName: supplier.displayName,
        })
        .from(I)
        .leftJoin(part, and(eq(part.id, I.partId), eq(part.organizationId, I.organizationId)))
        .leftJoin(sku, systemValueJoin(sku, optionalFieldId(fields.part_sku), part))
        .leftJoin(status, systemValueJoin(status, optionalFieldId(fields.part_stock_status), part))
        .leftJoin(
          supplier,
          and(eq(supplier.id, I.suggestedSupplierId), eq(supplier.organizationId, I.organizationId))
        )
        .where(where)
        .orderBy(
          ...orderColumns(input.sort ?? 'priority', input.direction ?? 'asc', part.displayName)
        )
        .limit(limit + 1)
        .offset(offset)

      const page = rows.slice(0, limit)
      return {
        run,
        items: page.map((row) => toListItem(row, run.asOfDay)),
        nextCursor: rows.length > limit ? offset + limit : null,
      }
    },
    'Failed to list plan items',
    { organizationId, runId: input.runId }
  )
}

/** A joined row as the list returns it. */
export function toListItem(
  row: {
    item: MrpPlanItemRow
    partName: string | null
    partSku: string | null
    stockStatus: string | null
    supplierName: string | null
  },
  asOfDay: DayKey
): MrpListItem {
  return {
    ...row.item,
    partName: row.partName,
    partSku: row.partSku,
    stockStatus: row.stockStatus,
    supplierName: row.supplierName,
    daysOfCover: row.item.stockoutDate ? daysBetween(asOfDay, row.item.stockoutDate) : null,
  }
}
