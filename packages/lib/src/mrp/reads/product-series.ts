// packages/lib/src/mrp/reads/product-series.ts

import { type Database, schema } from '@auxx/database'
import {
  addMonthsToDayKey,
  dayKeyInZone,
  monthsBetween,
  previousDayKey,
  todayInZone,
} from '@auxx/utils/calendar-day'
import { and, eq, inArray, min } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { readDailySeries } from '../../inventory/movements/fact/reads'
import { readFamilyVariants } from './family-variants'
import { guard } from './guard'
import { readItems } from './part-item'
import { itemEvents, type PartSeries, readReceiptsForParts } from './part-series'
import {
  PART_SERIES_STEP_MONTHS,
  PART_SERIES_WINDOW_MONTHS,
  type PartSeriesGrain,
  type PartSeriesWindow,
  type ProjectionWalkPoint,
  projectionEndDay,
  walkProjection,
} from './part-series-projection'
import {
  familyEvents,
  foldSeriesKeys,
  heldWalks,
  type ProductSeriesDay,
  type ProductSeriesKey,
  type ProductSeriesUsageBucket,
  rankVariants,
  rollUpUsage,
  sumFamilyDays,
  sumProjections,
} from './product-rollup'
import { loadRun, type MrpPlanItemRow } from './runs'

export interface ProductSeriesInput {
  productId: string
  window: PartSeriesWindow
  grain: PartSeriesGrain
  runId?: string | null
  /** Steps of `PART_SERIES_STEP_MONTHS` back from the run day; 0 shows the latest history plus the projection. */
  offset?: number
}

/** The family position chart (15 §4.2): `PartSeries` summed over stocked variants, stacked by `series`. */
export interface ProductSeries extends Omit<PartSeries, 'days' | 'usage' | 'zones'> {
  zones: null
  /** Stack keys in draw order, bottom first; at most 8 (D40). */
  series: ProductSeriesKey[]
  days: ProductSeriesDay[]
  usage: ProductSeriesUsageBucket[]
}

/** A product family's position chart: summed history, stacked per variant, and the summed projection. */
export async function readProductSeries(
  db: Database,
  organizationId: string,
  input: ProductSeriesInput
): Promise<Result<ProductSeries, Error>> {
  return guard(
    async () => {
      const { productId, grain } = input
      const [run, zone, variants] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
        readFamilyVariants(db, organizationId, productId),
      ])
      const asOf = run?.asOfDay ?? todayInZone(zone)
      const offset = input.offset ?? 0
      const end = addMonthsToDayKey(asOf, -PART_SERIES_STEP_MONTHS[input.window] * offset)
      const from = addMonthsToDayKey(end, -PART_SERIES_WINDOW_MONTHS[input.window])
      const to = previousDayKey(end)

      const stocked = variants.filter((v) => v.stocked)
      const stockedIds = stocked.map((v) => v.partId)
      const F = schema.InventoryMovementFact
      const [[first], rows, items] = await Promise.all([
        stockedIds.length
          ? db
              .select({ at: min(F.occurredAt) })
              .from(F)
              .where(and(eq(F.organizationId, organizationId), inArray(F.partId, stockedIds)))
          : [{ at: null }],
        readDailySeries(db, organizationId, { partIds: stockedIds, from, to, zone }),
        run ? readItems(db, organizationId, run.id, stockedIds) : new Map<string, MrpPlanItemRow>(),
      ])
      if (rows.isErr()) throw rows.error

      const ranked = rankVariants(stocked, items)
      const series = foldSeriesKeys(ranked)
      const base = {
        run,
        zone,
        runAsOf: asOf,
        zones: null,
        seasonal: ranked.some((v) => Boolean(items.get(v.partId)?.seasonalIndex)),
        series,
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
      const days = sumFamilyDays(rows.value, stockedIds, series)

      const planned = new Map<string, MrpPlanItemRow>()
      for (const v of ranked) {
        const item = items.get(v.partId)
        if (item && item.baseAdu !== null) planned.set(v.partId, item)
      }
      const walking = offset === 0 ? planned : new Map<string, MrpPlanItemRow>()
      const supply = await readReceiptsForParts(db, organizationId, walking, asOf)
      const walks: ProjectionWalkPoint[][] = []
      for (const [partId, item] of walking) {
        if (item.baseAdu === null) continue
        walks.push(
          walkProjection({
            fromDay: asOf,
            toDay: projectionEndDay(asOf, item.followingArrivalDate),
            onHand: item.onHand - item.openDemand,
            receipts: supply.get(partId)?.receipts ?? [],
            baseAdu: item.baseAdu,
            seasonalIndex: item.seasonalIndex,
            sigma: item.sigma,
            leadTimeDays: item.leadTimeDays,
          })
        )
      }
      if (walks.length > 0)
        walks.push(...heldWalks(stockedIds, new Set(walking.keys()), items, rows.value, asOf))
      const summed = sumProjections(walks)

      return {
        ...base,
        days: days.map(({ consumedByKey: _byKey, ...day }) => day),
        usage: rollUpUsage(days, summed.used, series.length, grain),
        projection: summed.projection,
        events: familyEvents(
          ranked.map((v) => ({
            name: v.name,
            itemEvents: itemEvents(items.get(v.partId)),
            supply: supply.get(v.partId)?.events ?? [],
          }))
        ),
        historyMonths,
        hasEarlier: dayKeyInZone(first.at, zone) < from,
      }
    },
    'Failed to read the product series',
    { organizationId, productId: input.productId }
  )
}
