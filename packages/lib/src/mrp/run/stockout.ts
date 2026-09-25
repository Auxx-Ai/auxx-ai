// packages/lib/src/mrp/run/stockout.ts

import { addDaysToDayKey, type DayKey, daysBetween, endOfMonthDay } from '@auxx/utils/calendar-day'
import { MRP_PROJECTION_HORIZON_DAYS } from '../client'
import type { OpenBuildInput, OpenPoLineInput, ProjectedReceipt, SeasonalIndex } from '../types'
import { projectUsage, rateOnDay } from './seasonality'

/** A part's projected stock from `fromDay`: receipts land at the start of their day, usage runs at the seasonal rate. */
export interface ProjectionInput {
  fromDay: DayKey
  /** On hand at the start of `fromDay`, less open demand. */
  onHand: number
  receipts: readonly ProjectedReceipt[]
  baseAdu: number
  seasonalIndex: SeasonalIndex | null
}

/** Offset of each receipt from `fromDay`, past-dated receipts clamped to 0. */
function receiptOffsets(input: ProjectionInput): { offset: number; quantity: number }[] {
  return input.receipts
    .map((r) => ({
      offset: Math.max(0, daysBetween(input.fromDay, r.day) ?? 0),
      quantity: r.quantity,
    }))
    .sort((a, b) => a.offset - b.offset)
}

/** Projected on hand at the start of `day`, after that day's receipts and before its usage. */
export function projectOnHandAt(input: ProjectionInput, day: DayKey): number {
  const offset = daysBetween(input.fromDay, day) ?? 0
  if (offset < 0) return input.onHand
  const received = receiptOffsets(input)
    .filter((r) => r.offset <= offset)
    .reduce((sum, r) => sum + r.quantity, 0)
  return (
    input.onHand + received - projectUsage(input.baseAdu, input.seasonalIndex, input.fromDay, day)
  )
}

/**
 * The day projected on hand first falls to `threshold`, or null within the horizon.
 * Continuous within a day: 200 falling to 45 at 2/day crosses at day 77.5, dated day 77 (02 §6.4).
 */
export function findCrossingDay(
  input: ProjectionInput,
  threshold: number,
  horizonDays: number = MRP_PROJECTION_HORIZON_DAYS
): DayKey | null {
  const receipts = receiptOffsets(input)
  let level = input.onHand
  let next = 0
  while (next < receipts.length && (receipts[next]?.offset ?? 0) === 0) {
    level += receipts[next]?.quantity ?? 0
    next++
  }
  if (level <= threshold) return input.fromDay
  if (input.baseAdu <= 0) return null

  let t = 0
  while (t < horizonDays) {
    const day = addDaysToDayKey(input.fromDay, t)
    const monthEnd = t + (daysBetween(day, endOfMonthDay(day)) ?? 0) + 1
    const receiptAt = receipts[next]?.offset ?? Number.POSITIVE_INFINITY
    const end = Math.min(monthEnd, receiptAt, horizonDays)
    const rate = rateOnDay(input.baseAdu, input.seasonalIndex, day)
    if (rate > 0 && level - rate * (end - t) <= threshold) {
      const crossing = t + (level - threshold) / rate
      return crossing < horizonDays ? addDaysToDayKey(input.fromDay, Math.floor(crossing)) : null
    }
    level -= rate * (end - t)
    t = end
    while (next < receipts.length && (receipts[next]?.offset ?? 0) === t) {
      level += receipts[next]?.quantity ?? 0
      next++
    }
  }
  return null
}

export interface StockoutResult {
  /** Projected on hand reaches 0. */
  stockoutDate: DayKey | null
  /** Projected on hand reaches the cushion (top of red; 0 when unbuffered). */
  cushionDate: DayKey | null
  /** Cushion date − stated lead time; null without either. */
  orderByDate: DayKey | null
}

/** Stockout, cushion and order-by dates for any part (02 §7 step 9). */
export function computeStockout(
  projection: ProjectionInput,
  cushion: number,
  leadTimeDays: number | null
): StockoutResult {
  if (projection.baseAdu <= 0) return { stockoutDate: null, cushionDate: null, orderByDate: null }
  const stockoutDate = findCrossingDay(projection, 0)
  const cushionDate = cushion > 0 ? findCrossingDay(projection, cushion) : stockoutDate
  const orderByDate =
    cushionDate && leadTimeDays !== null
      ? addDaysToDayKey(cushionDate, -Math.ceil(leadTimeDays))
      : null
  return { stockoutDate, cushionDate, orderByDate }
}

/** When an open PO line lands: expected date, else ordered + lead time, else today; overdue moves to today + median lateness. */
export function poLineLandingDay(
  line: Pick<OpenPoLineInput, 'expectedAt' | 'orderedAt'>,
  asOf: DayKey,
  leadTimeDays: number | null,
  medianLatenessDays: number | null
): DayKey {
  const expected =
    line.expectedAt ??
    (line.orderedAt && leadTimeDays !== null
      ? addDaysToDayKey(line.orderedAt, Math.ceil(leadTimeDays))
      : asOf)
  if (expected >= asOf) return expected
  return addDaysToDayKey(asOf, Math.max(0, Math.ceil(medianLatenessDays ?? 0)))
}

/** The receipts a part's projection sees: issued PO lines (never drafts, D17) and open builds. */
export function projectedReceiptsForPart(params: {
  asOf: DayKey
  poLines: readonly OpenPoLineInput[]
  builds: readonly OpenBuildInput[]
  /** Stated lead time of the line's vendor part (or the part's), for a line with no expected date. */
  leadTimeDays: number | null
  buildLeadTimeDays: number | null
  medianLatenessDays: number | null
}): ProjectedReceipt[] {
  const receipts: ProjectedReceipt[] = []
  for (const line of params.poLines) {
    if (line.status !== 'issued' || line.quantityOpen <= 0) continue
    receipts.push({
      day: poLineLandingDay(line, params.asOf, params.leadTimeDays, params.medianLatenessDays),
      quantity: line.quantityOpen,
    })
  }
  for (const build of params.builds) {
    if (build.quantityOpen <= 0) continue
    const due =
      build.dueDay ?? addDaysToDayKey(params.asOf, Math.ceil(params.buildLeadTimeDays ?? 0))
    receipts.push({ day: due < params.asOf ? params.asOf : due, quantity: build.quantityOpen })
  }
  return receipts
}
