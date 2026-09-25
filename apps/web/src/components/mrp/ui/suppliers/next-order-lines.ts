// apps/web/src/components/mrp/ui/suppliers/next-order-lines.ts

import { addDaysToDayKey, type DayKey, daysBetween, endOfMonthDay } from '@auxx/utils/calendar-day'

/** The "+x %" control's bounds; below −50 % an order line stops meaning anything. */
export const ADJUST_MIN = -50
export const ADJUST_MAX = 200

/** A new excluded set with `partId` flipped: ticking re-includes it, unticking excludes it. */
export function toggleExcluded(prev: ReadonlySet<string>, partId: string): Set<string> {
  const next = new Set(prev)
  if (!next.delete(partId)) next.add(partId)
  return next
}

/** The excluded ids in a stable order, so the same ticks are one query key. */
export function excludedIds(excluded: ReadonlySet<string>): string[] {
  return [...excluded].sort()
}

/** A typed percentage as a whole number inside the control's bounds; junk reads as 0. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, Math.round(value)))
}

/**
 * `quantity` raised (or lowered) by `percent`, rounded up to whole purchase units at the
 * line's own pack size (`quantity / purchaseUnits`); null stays null.
 */
export function adjustQuantity(
  quantity: number | null,
  purchaseUnits: number | null,
  percent: number
): { quantity: number; purchaseUnits: number | null } | null {
  if (quantity === null) return null
  if (percent === 0 || quantity <= 0) return { quantity, purchaseUnits }
  const pack = purchaseUnits && purchaseUnits > 0 ? quantity / purchaseUnits : 1
  // The epsilon keeps 360 × 1.1 / 20 from rounding up to a 20th pack on float noise.
  const units = Math.max(1, Math.ceil((quantity * (1 + percent / 100)) / pack - 1e-9))
  return {
    quantity: Math.round(units * pack * 1e4) / 1e4,
    purchaseUnits: purchaseUnits && purchaseUnits > 0 ? units : null,
  }
}

/** The date one ticked part would move the order to on its own: its order-by, never before the run's day. */
export function movesOrderTo(orderByDate: DayKey | null, asOfDay: DayKey): DayKey | null {
  if (orderByDate === null) return null
  return orderByDate < asOfDay ? asOfDay : orderByDate
}

/** A part pulls the order forward when its order-by lands before the supplier's rhythm date, ticked or not. */
export function movesOrderEarlier(orderByDate: DayKey | null, rhythmDate: DayKey | null): boolean {
  return rhythmDate !== null && orderByDate !== null && orderByDate < rhythmDate
}

/** The mean monthly index over `[from, to)` (the lib's `averageIndexOver`); null without an index or a range. */
export function seasonFactor(
  index: readonly number[] | null | undefined,
  from: DayKey | null,
  to: DayKey | null
): number | null {
  if (!index || index.length === 0 || !from || !to) return null
  let cursor = from
  let remaining = daysBetween(from, to) ?? 0
  if (remaining <= 0) return null
  let weighted = 0
  let days = 0
  while (remaining > 0) {
    const toMonthEnd = (daysBetween(cursor, endOfMonthDay(cursor)) ?? 0) + 1
    const run = Math.min(remaining, toMonthEnd)
    weighted += run * (index[Number(cursor.slice(5, 7)) - 1] ?? 1)
    days += run
    cursor = addDaysToDayKey(cursor, run)
    remaining -= run
  }
  return weighted / days
}

/** The draft lines for the current ticks: included parts with a positive (adjusted) quantity. */
export function draftItems(
  parts: ReadonlyArray<{
    partId: string
    excluded: boolean
    quantity: number | null
    purchaseUnits: number | null
  }>,
  percent: number
): Array<{ partId: string; quantity: number }> {
  const out: Array<{ partId: string; quantity: number }> = []
  for (const part of parts) {
    if (part.excluded) continue
    const adjusted = adjustQuantity(part.quantity, part.purchaseUnits, percent)
    if (adjusted && adjusted.quantity > 0)
      out.push({ partId: part.partId, quantity: adjusted.quantity })
  }
  return out
}
