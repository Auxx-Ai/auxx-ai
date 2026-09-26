// packages/lib/src/mrp/reads/list.ts

import { type Database, schema } from '@auxx/database'
import { type DayKey, daysBetween } from '@auxx/utils/calendar-day'
import { and, arrayOverlaps, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { buildParentGraph, type ParentGraph } from '../../inventory/costing/cost-calculator'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { optionalFieldId, systemFieldMap, systemValueJoin } from '../../resources/system-records'
import type {
  MrpFlag,
  MrpListSort,
  MrpOrderMode,
  MrpPlanTab,
  MrpSuggestionKind,
  MrpSupplyType,
} from '../client'
import { guard } from './guard'
import { readPartLabels } from './labels'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'
import { orderByHorizons } from './summary'

const I = schema.MrpPlanRunItem

const LIST_PART_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_sku',
  'part_stock_status',
  'part_kind',
] as const)

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
  /** Top-level finished goods above the part in the current BOM; a sold finished good lists itself. */
  finishedGoodIds: string[]
  /** Names parallel to `finishedGoodIds`; an unnamed part reads "Unnamed part". */
  finishedGoodNames: string[]
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

      const fields = await systemFieldMap(db, organizationId, LIST_PART_PICK)
      const part = alias(schema.EntityInstance, 'mrp_part')
      const supplier = alias(schema.EntityInstance, 'mrp_supplier')
      const sku = alias(schema.FieldValue, 'mrp_part_sku_v')
      const status = alias(schema.FieldValue, 'mrp_part_status_v')
      const kind = alias(schema.FieldValue, 'mrp_part_kind_v')

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
          partKind: kind.optionId,
          supplierName: supplier.displayName,
        })
        .from(I)
        .leftJoin(part, and(eq(part.id, I.partId), eq(part.organizationId, I.organizationId)))
        .leftJoin(sku, systemValueJoin(sku, optionalFieldId(fields.part_sku), part))
        .leftJoin(status, systemValueJoin(status, optionalFieldId(fields.part_stock_status), part))
        .leftJoin(kind, systemValueJoin(kind, optionalFieldId(fields.part_kind), part))
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
      const parents = buildParentGraph(
        (await getOrgCache().get(organizationId, 'subpartEdges')) ?? []
      )
      const finishedGoods = new Map(
        page.map((row) => [
          row.item.partId,
          finishedGoodsAbove(
            row.item.partId,
            parents,
            isSoldFinishedGood(row.partKind, row.item.adu)
          ),
        ])
      )
      const finishedGoodLabels = await readPartLabels(db, organizationId, [
        ...new Set([...finishedGoods.values()].flat()),
      ])
      return {
        run,
        items: page.map((row) => {
          const finishedGoodIds = finishedGoods.get(row.item.partId) ?? []
          return toListItem(row, run.asOfDay, {
            finishedGoodIds,
            finishedGoodNames: finishedGoodIds.map(
              (id) => finishedGoodLabels.get(id)?.name ?? 'Unnamed part'
            ),
          })
        }),
        nextCursor: rows.length > limit ? offset + limit : null,
      }
    },
    'Failed to list plan items',
    { organizationId, runId: input.runId }
  )
}

/** A finished good with usage in the window; with no parents its usage is its sales. */
export function isSoldFinishedGood(kind: string | null, adu: number | null): boolean {
  return kind === 'finished_good' && (adu ?? 0) > 0
}

/** Roots above `partId` in the parent graph, sorted; a root part lists itself only when `selfIsFinishedGood`. */
export function finishedGoodsAbove(
  partId: string,
  parents: ParentGraph,
  selfIsFinishedGood: boolean
): string[] {
  if (!parents.get(partId)?.length) return selfIsFinishedGood ? [partId] : []
  const roots = new Set<string>()
  const seen = new Set<string>([partId])
  const stack = [...(parents.get(partId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const up = parents.get(id) ?? []
    if (up.length === 0) roots.add(id)
    else stack.push(...up)
  }
  return [...roots].sort()
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
  asOfDay: DayKey,
  finishedGoods: Pick<MrpListItem, 'finishedGoodIds' | 'finishedGoodNames'> = {
    finishedGoodIds: [],
    finishedGoodNames: [],
  }
): MrpListItem {
  return {
    ...row.item,
    partName: row.partName,
    partSku: row.partSku,
    stockStatus: row.stockStatus,
    supplierName: row.supplierName,
    daysOfCover: row.item.stockoutDate ? daysBetween(asOfDay, row.item.stockoutDate) : null,
    ...finishedGoods,
  }
}
