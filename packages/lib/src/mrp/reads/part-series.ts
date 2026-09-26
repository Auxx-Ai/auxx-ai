// packages/lib/src/mrp/reads/part-series.ts

import { type Database, schema } from '@auxx/database'
import {
  addDaysToDayKey,
  addMonthsToDayKey,
  type DayKey,
  dayKeyInZone,
  monthsBetween,
  previousDayKey,
  todayInZone,
} from '@auxx/utils/calendar-day'
import { and, eq, min } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { type DailySeriesRow, readDailySeries } from '../../inventory/movements/fact/reads'
import { readOpenBuilds } from '../run/load-inputs'
import { poLineLandingDay } from '../run/stockout'
import { isStockoutDay } from '../run/usage'
import type { OpenPoLineInput } from '../types'
import { guard } from './guard'
import { readRecordNames } from './labels'
import { readItems } from './part-item'
import {
  bucketUsage,
  PART_SERIES_STEP_MONTHS,
  PART_SERIES_WINDOW_MONTHS,
  type PartSeriesGrain,
  type PartSeriesProjectionPoint,
  type PartSeriesUsageBucket,
  type PartSeriesWindow,
  projectionEndDay,
  walkProjection,
} from './part-series-projection'
import { readOpenIssuedPoLines } from './purchase-orders'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'
import { readSupplyHistory } from './supply-history'

export interface PartSeriesDay extends Omit<DailySeriesRow, 'partId'> {
  stockout: boolean
}

export interface PartSeriesEvent {
  day: DayKey
  kind: 'po_arrival' | 'build_due' | 'order_by' | 'stockout'
  label: string
  qty?: number
}

export interface PartSeriesInput {
  partId: string
  window: PartSeriesWindow
  grain: PartSeriesGrain
  runId?: string | null
  /** Steps of `PART_SERIES_STEP_MONTHS` back from the run day; 0 shows the latest history plus the projection. */
  offset?: number
}

/** The position chart's data (07 §5.1); empty `days` means the part has never moved. */
export interface PartSeries {
  run: MrpRunRef | null
  zone: string
  days: PartSeriesDay[]
  usage: PartSeriesUsageBucket[]
  projection: PartSeriesProjectionPoint[]
  events: PartSeriesEvent[]
  zones: { topOfRed: number; topOfYellow: number; topOfGreen: number } | null
  /** The day history stops and the projection starts: the run's day, else today. */
  runAsOf: DayKey
  /** The run stored a seasonal index; false means the projection is flat. */
  seasonal: boolean
  /** Whole months since the part's first movement. */
  historyMonths: number
  /** The part moved before this window, so it can page further back. */
  hasEarlier: boolean
}

/** Zones for a buffered item; null otherwise. */
export function zonesFromItem(item: MrpPlanItemRow | undefined): PartSeries['zones'] {
  if (!item?.buffered) return null
  const { topOfRed, topOfYellow, topOfGreen } = item
  if (topOfRed === null || topOfYellow === null || topOfGreen === null) return null
  return { topOfRed, topOfYellow, topOfGreen }
}

/** The run's order-by and stockout dates as chart markers. */
export function itemEvents(item: MrpPlanItemRow | undefined): PartSeriesEvent[] {
  const events: PartSeriesEvent[] = []
  if (item?.orderByDate)
    events.push({
      day: item.orderByDate,
      kind: 'order_by',
      label: 'Order by',
      ...(item.suggestedQty ? { qty: item.suggestedQty } : {}),
    })
  if (item?.stockoutDate)
    events.push({ day: item.stockoutDate, kind: 'stockout', label: 'Stockout' })
  return events
}

const byDay = (a: { day: DayKey }, b: { day: DayKey }) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : 0

/** Median lateness per vendor part, read only when a line is overdue (02 §6.2). */
async function latenessByVendorPart(
  db: Database,
  organizationId: string,
  partId: string
): Promise<{ byId: Map<string, number>; fallback: number | null }> {
  const history = await readSupplyHistory(db, organizationId, { partId })
  if (history.isErr()) throw history.error
  const byId = new Map<string, number>()
  let fallback: number | null = null
  for (const vp of history.value.vendorParts) {
    const lateness = vp.stats.medianLatenessDays
    if (lateness === null) continue
    if (vp.vendorPartId) byId.set(vp.vendorPartId, lateness)
    if (vp.stated.isPreferred || fallback === null) fallback = lateness
  }
  return { byId, fallback }
}

/** Open issued PO lines and builds as dated receipts with their chart markers. */
async function readReceipts(
  db: Database,
  organizationId: string,
  partId: string,
  item: MrpPlanItemRow,
  asOf: DayKey
): Promise<{ receipts: { day: DayKey; quantity: number }[]; events: PartSeriesEvent[] }> {
  const [poLines, builds] = await Promise.all([
    readOpenIssuedPoLines(db, organizationId, [partId]),
    readOpenBuilds(db, organizationId, new Set([partId])),
  ])
  const leadTime = item.leadTimeSource === 'vendor' ? item.leadTimeDays : null
  const buildLeadTime = item.leadTimeSource === 'build' ? item.leadTimeDays : null
  // The line's own date, before `poLineLandingDay` moves an overdue one.
  const due = (line: OpenPoLineInput) =>
    line.expectedAt ??
    (line.orderedAt && leadTime !== null
      ? addDaysToDayKey(line.orderedAt, Math.ceil(leadTime))
      : asOf)
  const lateness = poLines.some((l) => due(l) < asOf)
    ? await latenessByVendorPart(db, organizationId, partId)
    : null
  const [poNames, buildNames] = await Promise.all([
    readRecordNames(
      db,
      organizationId,
      'purchase_order',
      poLines.map((l) => l.purchaseOrderId)
    ),
    readRecordNames(
      db,
      organizationId,
      'build',
      builds.map((b) => b.id)
    ),
  ])

  const receipts: { day: DayKey; quantity: number }[] = []
  const events: PartSeriesEvent[] = []
  for (const line of poLines) {
    const median =
      (line.vendorPartId ? lateness?.byId.get(line.vendorPartId) : undefined) ??
      lateness?.fallback ??
      null
    const day = poLineLandingDay(line, asOf, leadTime, median)
    const late = due(line) < asOf
    const name = poNames.get(line.purchaseOrderId) ?? 'Purchase order'
    receipts.push({ day, quantity: line.quantityOpen })
    events.push({
      day,
      kind: 'po_arrival',
      label: late ? `${name} (overdue)` : name,
      qty: line.quantityOpen,
    })
  }
  for (const build of builds) {
    const dueDay = build.dueDay ?? addDaysToDayKey(asOf, Math.ceil(buildLeadTime ?? 0))
    const day = dueDay < asOf ? asOf : dueDay
    receipts.push({ day, quantity: build.quantityOpen })
    events.push({
      day,
      kind: 'build_due',
      label: buildNames.get(build.id) ?? 'Build',
      qty: build.quantityOpen,
    })
  }
  return { receipts, events }
}

/** One part's position chart (07 §5.1): ledger history, bucketed usage and the run's projection. */
export async function readPartSeries(
  db: Database,
  organizationId: string,
  input: PartSeriesInput
): Promise<Result<PartSeries, Error>> {
  return guard(
    async () => {
      const { partId, grain } = input
      const [run, zone] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
      ])
      const asOf = run?.asOfDay ?? todayInZone(zone)
      const offset = input.offset ?? 0
      const end = addMonthsToDayKey(asOf, -PART_SERIES_STEP_MONTHS[input.window] * offset)
      const from = addMonthsToDayKey(end, -PART_SERIES_WINDOW_MONTHS[input.window])
      const to = previousDayKey(end)

      const F = schema.InventoryMovementFact
      const [[first], series, items] = await Promise.all([
        db
          .select({ at: min(F.occurredAt) })
          .from(F)
          .where(and(eq(F.organizationId, organizationId), eq(F.partId, partId))),
        readDailySeries(db, organizationId, { partIds: [partId], from, to, zone }),
        run ? readItems(db, organizationId, run.id, [partId]) : new Map<string, MrpPlanItemRow>(),
      ])
      if (series.isErr()) throw series.error
      const item = items.get(partId)
      const base = {
        run,
        zone,
        runAsOf: asOf,
        // Zones are today's buffer; drawn over an earlier window they'd read as history.
        zones: offset === 0 ? zonesFromItem(item) : null,
        seasonal: Boolean(item?.seasonalIndex),
      }
      if (!first?.at) {
        return {
          ...base,
          days: [],
          usage: [],
          projection: [],
          events: [],
          historyMonths: 0,
          hasEarlier: false,
        }
      }
      const historyMonths = Math.max(0, monthsBetween(dayKeyInZone(first.at, zone), asOf) ?? 0)

      const days = series.value.map(({ partId: pid, ...point }) => ({
        ...point,
        stockout: isStockoutDay({ partId: pid, ...point }),
      }))

      let walk: ReturnType<typeof walkProjection> = []
      const events = itemEvents(item)
      if (offset === 0 && item && item.baseAdu !== null) {
        const supply = await readReceipts(db, organizationId, partId, item, asOf)
        events.push(...supply.events)
        walk = walkProjection({
          fromDay: asOf,
          toDay: projectionEndDay(asOf, item.followingArrivalDate),
          onHand: item.onHand - item.openDemand,
          receipts: supply.receipts,
          baseAdu: item.baseAdu,
          seasonalIndex: item.seasonalIndex,
          sigma: item.sigma,
          leadTimeDays: item.leadTimeDays,
        })
      }
      events.sort(byDay)

      return {
        ...base,
        days,
        usage: bucketUsage(days, walk, grain),
        projection: walk.map(({ used: _used, ...point }) => point),
        events,
        historyMonths,
        hasEarlier: dayKeyInZone(first.at, zone) < from,
      }
    },
    'Failed to read the part series',
    { organizationId, partId: input.partId }
  )
}
