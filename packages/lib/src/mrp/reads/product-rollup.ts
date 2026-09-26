// packages/lib/src/mrp/reads/product-rollup.ts

import type { DayKey } from '@auxx/utils/calendar-day'
import type { DailySeriesRow } from '../../inventory/movements/fact/reads'
import type { MrpSuggestionKind } from '../client'
import { isStockoutDay } from '../run/usage'
import type { FamilyVariant } from './family-variants'
import type { walkBom } from './part-item'
import type { PartSeriesDay, PartSeriesEvent } from './part-series'
import {
  bucketUsage,
  type PartSeriesGrain,
  type PartSeriesProjectionPoint,
  type PartSeriesUsageBucket,
  type ProjectionWalkPoint,
} from './part-series-projection'
import type { MrpPlanItemRow } from './runs'
import { pickLimitingNode } from './sell-through'

/** At most this many stack keys; past it the tail folds into `other` (15 D40). */
export const PRODUCT_SERIES_MAX_KEYS = 8
export const OTHER_SERIES_KEY = 'other'

/** One stack key of the family chart; `key` is a part id or `'other'`. */
export interface ProductSeriesKey {
  key: string
  name: string
  partIds: string[]
}

export type ProductSeriesDay = PartSeriesDay & { onHandByKey: number[] }
export type ProductSeriesUsageBucket = PartSeriesUsageBucket & { consumedByKey: number[] }

const round = (n: number) => Math.round(n * 100) / 100

/** Run `baseAdu` desc, variants without one (or without an item) last; ties by name, then id. */
export function rankVariants<V extends Pick<FamilyVariant, 'partId' | 'name'>>(
  variants: readonly V[],
  items: ReadonlyMap<string, Pick<MrpPlanItemRow, 'baseAdu'>>
): V[] {
  const adu = (v: V) => items.get(v.partId)?.baseAdu ?? null
  return [...variants].sort((a, b) => {
    const x = adu(a)
    const y = adu(b)
    if (x !== y) {
      if (x === null) return 1
      if (y === null) return -1
      return y - x
    }
    return (a.name ?? '').localeCompare(b.name ?? '') || a.partId.localeCompare(b.partId)
  })
}

/** Ranked variants as stack keys: all own keys up to 8, else the top 7 plus one `other`. */
export function foldSeriesKeys(
  ranked: readonly Pick<FamilyVariant, 'partId' | 'name'>[]
): ProductSeriesKey[] {
  const own = (v: Pick<FamilyVariant, 'partId' | 'name'>): ProductSeriesKey => ({
    key: v.partId,
    name: v.name ?? 'Unnamed part',
    partIds: [v.partId],
  })
  if (ranked.length <= PRODUCT_SERIES_MAX_KEYS) return ranked.map(own)
  const head = ranked.slice(0, PRODUCT_SERIES_MAX_KEYS - 1).map(own)
  const tail = ranked.slice(PRODUCT_SERIES_MAX_KEYS - 1).map((v) => v.partId)
  return [...head, { key: OTHER_SERIES_KEY, name: 'Other', partIds: tail }]
}

/**
 * Per-day family sums over the stocked parts' dense series. `stockout` holds only when every
 * part is out that day (15 D39); a part missing from a day counts as not out.
 */
export function sumFamilyDays(
  rows: readonly DailySeriesRow[],
  partIds: readonly string[],
  keys: readonly ProductSeriesKey[]
): (ProductSeriesDay & { consumedByKey: number[] })[] {
  const keyOf = new Map<string, number>()
  keys.forEach((k, i) => {
    for (const id of k.partIds) keyOf.set(id, i)
  })
  const byDay = new Map<DayKey, DailySeriesRow[]>()
  for (const row of rows) {
    const list = byDay.get(row.day)
    if (list) list.push(row)
    else byDay.set(row.day, [row])
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, dayRows]) => {
      const onHandByKey = keys.map(() => 0)
      const consumedByKey = keys.map(() => 0)
      let consumed = 0
      let scrapped = 0
      let net = 0
      let onHandEod = 0
      const out = new Set<string>()
      for (const row of dayRows) {
        consumed += row.consumed
        scrapped += row.scrapped
        net += row.net
        onHandEod += row.onHandEod
        if (isStockoutDay(row)) out.add(row.partId)
        const k = keyOf.get(row.partId)
        if (k !== undefined) {
          onHandByKey[k] = (onHandByKey[k] ?? 0) + Math.max(0, row.onHandEod)
          consumedByKey[k] = (consumedByKey[k] ?? 0) + row.consumed
        }
      }
      return {
        day,
        consumed,
        scrapped,
        net,
        onHandEod,
        stockout: partIds.length > 0 && partIds.every((id) => out.has(id)),
        onHandByKey,
        consumedByKey,
      }
    })
}

/**
 * Sums per-variant walks that all start on the run day. The band half-width is √Σ half²
 * (independent variances). A shorter walk holds its last level with no further usage.
 */
export function sumProjections(walks: readonly (readonly ProjectionWalkPoint[])[]): {
  projection: PartSeriesProjectionPoint[]
  used: { day: DayKey; used: number }[]
} {
  const length = Math.max(0, ...walks.map((w) => w.length))
  const longest = walks.find((w) => w.length === length)
  const projection: PartSeriesProjectionPoint[] = []
  const used: { day: DayKey; used: number }[] = []
  for (let t = 0; t < length; t++) {
    const day = longest?.[t]?.day as DayKey
    let onHand = 0
    let variance = 0
    let usedToday = 0
    for (const walk of walks) {
      const point = walk[t] ?? walk[walk.length - 1]
      if (!point) continue
      onHand += point.onHand
      variance += (point.high - point.onHand) ** 2
      if (walk[t]) usedToday += point.used
    }
    const half = Math.sqrt(variance)
    projection.push({
      day,
      onHand: round(onHand),
      low: round(Math.max(0, onHand - half)),
      high: round(onHand + half),
    })
    used.push({ day, used: usedToday })
  }
  return { projection, used }
}

/**
 * One-point walks on `day` for stocked variants that do not walk (no item or no `baseAdu`): the
 * variant's level with no usage and no band, so the summed projection has no cliff at the run day.
 */
export function heldWalks(
  stockedIds: readonly string[],
  walkingIds: ReadonlySet<string>,
  items: ReadonlyMap<string, Pick<MrpPlanItemRow, 'onHand' | 'openDemand'>>,
  rows: readonly DailySeriesRow[],
  day: DayKey
): ProjectionWalkPoint[][] {
  const last = new Map<string, DailySeriesRow>()
  for (const row of rows) {
    const seen = last.get(row.partId)
    if (!seen || row.day > seen.day) last.set(row.partId, row)
  }
  return stockedIds
    .filter((id) => !walkingIds.has(id))
    .map((id) => {
      const item = items.get(id)
      const level = item
        ? Math.max(0, item.onHand - item.openDemand)
        : (last.get(id)?.onHandEod ?? 0)
      return [{ day, onHand: level, low: level, high: level, used: 0 }]
    })
}

/** The family's usage buckets, each carrying its per-key consumption. */
export function rollUpUsage(
  days: readonly (Pick<ProductSeriesDay, 'day' | 'consumed' | 'stockout'> & {
    consumedByKey: number[]
  })[],
  future: readonly { day: DayKey; used: number }[],
  keyCount: number,
  grain: PartSeriesGrain
): ProductSeriesUsageBucket[] {
  const perKey = Array.from({ length: keyCount }, (_, i) => {
    const buckets = bucketUsage(
      days.map((d) => ({ day: d.day, consumed: d.consumedByKey[i] ?? 0, stockout: false })),
      [],
      grain
    )
    return new Map(buckets.map((b) => [b.bucket, b.consumed ?? 0]))
  })
  return bucketUsage(days, future, grain).map((b) => ({
    ...b,
    consumedByKey: perKey.map((m) => m.get(b.bucket) ?? 0),
  }))
}

/**
 * Each variant's run markers prefixed with its name; arrivals and build dues collapse to one
 * marker per kind per day listing the documents, `qty` summed.
 */
export function familyEvents(
  variants: readonly {
    name: string | null
    itemEvents: PartSeriesEvent[]
    supply: PartSeriesEvent[]
  }[]
): PartSeriesEvent[] {
  const events: PartSeriesEvent[] = []
  const landing = new Map<string, { event: PartSeriesEvent; labels: string[] }>()
  for (const v of variants) {
    const name = v.name ?? 'Unnamed part'
    for (const e of v.itemEvents) events.push({ ...e, label: `${name} · ${e.label}` })
    for (const e of v.supply) {
      const id = `${e.day}|${e.kind}`
      const group = landing.get(id)
      if (!group) {
        landing.set(id, { event: { ...e }, labels: [e.label] })
        continue
      }
      if (!group.labels.includes(e.label)) group.labels.push(e.label)
      if (e.qty !== undefined) group.event.qty = (group.event.qty ?? 0) + e.qty
    }
  }
  for (const { event, labels } of landing.values())
    events.push({ ...event, label: labels.join(', ') })
  return events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

type WalkedNode = ReturnType<typeof walkBom>[number]

/** The earliest stored stockout over the union of the variants' BOMs, with how many BOMs hold it (15 D42). */
export function pickFamilyLimiting(
  trees: readonly (readonly WalkedNode[])[],
  items: ReadonlyMap<string, Pick<MrpPlanItemRow, 'stockoutDate'>>
): { node: WalkedNode; variantCount: number } | null {
  const union = new Map<string, WalkedNode>()
  const count = new Map<string, number>()
  for (const tree of trees) {
    for (const partId of new Set(tree.map((n) => n.partId)))
      count.set(partId, (count.get(partId) ?? 0) + 1)
    for (const node of tree) if (!union.has(node.partId)) union.set(node.partId, node)
  }
  const node = pickLimitingNode([...union.values()], items)
  return node ? { node, variantCount: count.get(node.partId) ?? 0 } : null
}

/** Σ over variants of `max(0, sold − built − max(0, opening))`, floored per variant as the part read does. */
export function familyUnbuilt(
  variants: readonly { sold: number; built: number; opening: number }[]
): number {
  return variants.reduce(
    (sum, v) => sum + Math.max(0, v.sold - v.built - Math.max(0, v.opening)),
    0
  )
}

/** Sold, built and unbuilt over the variants with a BOM; a variant sold as-is adds nothing (15 D42). */
export function familySellThroughTotals(
  variants: readonly {
    tree: readonly WalkedNode[]
    sold: number
    built: number
    opening: number
  }[]
): { withBom: number; sold: number; built: number; unbuilt: number } {
  const withBom = variants.filter((v) => v.tree.length > 0)
  return {
    withBom: withBom.length,
    sold: withBom.reduce((sum, v) => sum + v.sold, 0),
    built: withBom.reduce((sum, v) => sum + v.built, 0),
    unbuilt: familyUnbuilt(withBom),
  }
}

/** Σ on hand ÷ Σ ADU in whole days from the run day; null when Σ ADU is 0. */
export function familyDaysOfCover(onHand: number, adu: number): number | null {
  if (adu <= 0) return null
  return Math.max(0, Math.floor(onHand / adu))
}

export interface ProductTotals {
  onHand: number
  onOrder: number
  netFlow: number
  openDemand: number
  adu: number
  daysOfCover: number | null
  minCover: { partId: string; days: number } | null
  firstStockout: { partId: string; day: DayKey } | null
  firstOrderBy: { partId: string; day: DayKey; isOverdue: boolean } | null
  suggestions: Record<MrpSuggestionKind, number>
  buffered: number
  stocked: number
  inRun: number
}

/** The key-number sums over the stocked variants' items (15 §3.2). */
export function productTotals(
  stocked: readonly {
    partId: string
    item: (MrpPlanItemRow & { daysOfCover: number | null }) | null
  }[]
): ProductTotals {
  const totals: ProductTotals = {
    onHand: 0,
    onOrder: 0,
    netFlow: 0,
    openDemand: 0,
    adu: 0,
    daysOfCover: null,
    minCover: null,
    firstStockout: null,
    firstOrderBy: null,
    suggestions: { purchase: 0, build: 0 },
    buffered: 0,
    stocked: stocked.length,
    inRun: 0,
  }
  for (const { partId, item } of stocked) {
    if (!item) continue
    totals.inRun++
    totals.onHand += item.onHand
    totals.onOrder += item.onOrder
    totals.netFlow += item.netFlow
    totals.openDemand += item.openDemand
    totals.adu += item.adu ?? 0
    if (item.buffered) totals.buffered++
    if (item.suggestionKind) totals.suggestions[item.suggestionKind]++
    if (item.daysOfCover !== null && (!totals.minCover || item.daysOfCover < totals.minCover.days))
      totals.minCover = { partId, days: item.daysOfCover }
    if (
      item.stockoutDate &&
      (!totals.firstStockout || item.stockoutDate < totals.firstStockout.day)
    )
      totals.firstStockout = { partId, day: item.stockoutDate }
    if (item.orderByDate && (!totals.firstOrderBy || item.orderByDate < totals.firstOrderBy.day))
      totals.firstOrderBy = { partId, day: item.orderByDate, isOverdue: item.isOverdue }
  }
  totals.daysOfCover = familyDaysOfCover(totals.onHand, totals.adu)
  return {
    ...totals,
    onHand: round(totals.onHand),
    onOrder: round(totals.onOrder),
    netFlow: round(totals.netFlow),
    openDemand: round(totals.openDemand),
    adu: round(totals.adu),
  }
}
