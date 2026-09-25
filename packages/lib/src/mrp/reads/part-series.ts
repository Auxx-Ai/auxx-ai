// packages/lib/src/mrp/reads/part-series.ts

import type { Database } from '@auxx/database'
import { type DayKey, daysBetween, isDayKeyShape } from '@auxx/utils/calendar-day'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { BadRequestError } from '../../errors'
import { type DailySeriesRow, readDailySeries } from '../../inventory/movements/fact/reads'
import { isStockoutDay } from '../run/usage'
import { guard } from './guard'
import { readItems } from './part-item'
import { loadRun, type MrpPlanItemRow, type MrpRunRef } from './runs'

/** Longest range one chart request may ask for; the 12-month window plus a projection margin. */
const MAX_SERIES_DAYS = 800

export interface PartSeriesDay extends Omit<DailySeriesRow, 'partId'> {
  stockout: boolean
}

export interface PartSeriesEvent {
  day: DayKey
  kind: 'order_by' | 'stockout' | 'next_arrival' | 'following_arrival'
}

export interface PartSeries {
  run: MrpRunRef | null
  zone: string
  days: PartSeriesDay[]
  zones: { topOfRed: number; topOfYellow: number; topOfGreen: number } | null
  /** The stored dates the chart marks; nothing is projected on read. */
  events: PartSeriesEvent[]
  /** What a client-side projection line starts from, as the run stored it. */
  projectionBasis: Pick<
    MrpPlanItemRow,
    'onHand' | 'openDemand' | 'baseAdu' | 'seasonalIndex' | 'sigma' | 'leadTimeDays'
  > | null
}

/** The run item's zones and dated markers, as the chart overlays them. */
export function overlayFromItem(
  item: MrpPlanItemRow | undefined
): Pick<PartSeries, 'zones' | 'events' | 'projectionBasis'> {
  if (!item) return { zones: null, events: [], projectionBasis: null }
  const zones =
    item.buffered && item.topOfRed !== null && item.topOfYellow !== null && item.topOfGreen !== null
      ? { topOfRed: item.topOfRed, topOfYellow: item.topOfYellow, topOfGreen: item.topOfGreen }
      : null
  const events: PartSeriesEvent[] = []
  const mark = (day: DayKey | null, kind: PartSeriesEvent['kind']) => {
    if (day) events.push({ day, kind })
  }
  mark(item.orderByDate, 'order_by')
  mark(item.stockoutDate, 'stockout')
  mark(item.nextArrivalDate, 'next_arrival')
  mark(item.followingArrivalDate, 'following_arrival')
  events.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return {
    zones,
    events,
    projectionBasis: {
      onHand: item.onHand,
      openDemand: item.openDemand,
      baseAdu: item.baseAdu,
      seasonalIndex: item.seasonalIndex,
      sigma: item.sigma,
      leadTimeDays: item.leadTimeDays,
    },
  }
}

/** One part's dense daily series from the mirror (07 §5.1) with the run's zones and dates overlaid. */
export async function readPartSeries(
  db: Database,
  organizationId: string,
  input: { partId: string; from: DayKey; to: DayKey; runId?: string | null }
): Promise<Result<PartSeries, Error>> {
  return guard(
    async () => {
      const { partId, from, to } = input
      const span = isDayKeyShape(from) && isDayKeyShape(to) ? daysBetween(from, to) : null
      if (span === null || span < 0) throw new BadRequestError('Invalid day range')
      if (span > MAX_SERIES_DAYS)
        throw new BadRequestError(`A series covers at most ${MAX_SERIES_DAYS} days`)

      const [run, zone] = await Promise.all([
        loadRun(db, organizationId, input.runId),
        readBookTimeZoneOrUtc(organizationId),
      ])
      const [series, items] = await Promise.all([
        readDailySeries(db, organizationId, { partIds: [partId], from, to, zone }),
        run ? readItems(db, organizationId, run.id, [partId]) : new Map<string, MrpPlanItemRow>(),
      ])
      if (series.isErr()) throw series.error
      const days = series.value.map(({ partId: pid, ...point }) => ({
        ...point,
        stockout: isStockoutDay({ partId: pid, ...point }),
      }))
      return { run, zone, days, ...overlayFromItem(items.get(partId)) }
    },
    'Failed to read the part series',
    { organizationId, partId: input.partId }
  )
}
