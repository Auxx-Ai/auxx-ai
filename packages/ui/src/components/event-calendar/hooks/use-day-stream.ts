// packages/ui/src/components/event-calendar/hooks/use-day-stream.ts

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { useCallback, useMemo, useRef } from 'react'
import { StreamEndYear, StreamStartYear } from '../constants'

export interface DayStream {
  /** Day 0 of the finite stream (StreamStartYear-01-01) — the anchor every slot maps off. */
  epoch: Date
  /** Number of VISIBLE slots — `totalDays` for the identity stream, `slots.length` when filtered. */
  dayCount: number
  /** Visible-slot index → its calendar `Date`. */
  dayAt: (slot: number) => Date
  /** Calendar `Date` → its visible-slot index (nearest visible slot when `date` is hidden). */
  dayIndexOf: (date: Date) => number
  /** Bumps only when the stream flips between identity and filtered — i.e. on a hide/reveal MODE
   * change (the toggle). Views key their scroll re-anchor off it (plan 42 §2): that transition
   * shifts which day a fixed `scrollLeft` shows, and the `currentDate → scroll` effect won't
   * re-fire without this signal. It deliberately does NOT bump on rebuilds *within* filtered mode
   * (a booked off-day appearing as events load mid-scroll) — re-anchoring there would yank the
   * user back to `currentDate` and read as a scroll reset. */
  slotsVersion: number
}

/**
 * The finite, horizontally-virtualized day-stream shell shared by `WeekView`,
 * `ResourceTimelineView`, and `HorizontalTimelineView` (plan 42 §1). Extracted from the three
 * views' near-verbatim inline `epoch`/`dayCount`/`dayAt`/`dayIndexOf` copies.
 *
 * With no predicate it is the **identity** stream — byte-identical to the previous inline code, no
 * array materialized. With an `isDayHidden` predicate it drops every calendar day the predicate
 * hides, collapsing the remaining days into a contiguous visible-slot space (so hidden off-days
 * vanish and the days around them sit flush). Slot geometry stays uniform-width, so the views'
 * virtualizer count, settle-snap, scroll-to, visible-range emit, and timeline zoom `anchorH` all
 * keep working off the slot index unchanged.
 *
 * ⚠️ Never collapses to empty — if the predicate would hide every day, it falls back to identity.
 */
export function useDayStream(isDayHidden?: (date: Date) => boolean): DayStream {
  const { epoch, totalDays } = useMemo(() => {
    const start = startOfDay(new Date(StreamStartYear, 0, 1))
    const count = differenceInCalendarDays(new Date(StreamEndYear, 0, 1), start) + 1
    return { epoch: start, totalDays: count }
  }, [])

  // The visible calendar-day indices, ascending. `null` = identity stream (no array built).
  const slots = useMemo(() => {
    if (!isDayHidden) return null
    const kept: number[] = []
    for (let i = 0; i < totalDays; i++) {
      if (!isDayHidden(addDays(epoch, i))) kept.push(i)
    }
    // Never collapse to empty — a predicate that hides everything falls back to identity.
    return kept.length > 0 ? kept : null
  }, [isDayHidden, epoch, totalDays])

  const dayCount = slots ? slots.length : totalDays

  // Monotonic token that changes ONLY when the stream flips identity↔filtered (a hide/reveal mode
  // change) — NOT on within-filtered rebuilds (daysWithVisits churn as events load during a
  // scroll). Its value is opaque; consumers only compare it against its previous value. Derived at
  // render time (idempotent, StrictMode-safe: a repeated render with the same `isFiltered` won't
  // bump) rather than via useMemo, whose dep would have to be the value it produces.
  const isFiltered = slots !== null
  const versionRef = useRef(0)
  const prevFilteredRef = useRef(isFiltered)
  if (prevFilteredRef.current !== isFiltered) {
    prevFilteredRef.current = isFiltered
    versionRef.current += 1
  }
  const slotsVersion = versionRef.current

  const dayAt = useCallback(
    (slot: number) => {
      if (!slots) return addDays(epoch, slot)
      const clamped = Math.min(dayCount - 1, Math.max(0, slot))
      // `clamped` is always a valid index into the non-empty `slots` array.
      return addDays(epoch, slots[clamped] as number)
    },
    [slots, epoch, dayCount]
  )

  const dayIndexOf = useCallback(
    (date: Date) => {
      const raw = differenceInCalendarDays(date, epoch)
      if (!slots) return Math.min(dayCount - 1, Math.max(0, raw))
      // Binary-search the ascending `slots` for the visible slot nearest to calendar-day `raw`.
      const last = slots.length - 1
      if (raw <= (slots[0] as number)) return 0
      if (raw >= (slots[last] as number)) return last
      let lo = 0
      let hi = last
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const midVal = slots[mid] as number
        if (midVal === raw) return mid
        if (midVal < raw) lo = mid + 1
        else hi = mid
      }
      // `lo` is the first slot with `slots[lo] >= raw`; pick whichever of lo-1/lo is nearer.
      const loVal = slots[lo - 1] as number
      const hiVal = slots[lo] as number
      return raw - loVal <= hiVal - raw ? lo - 1 : lo
    },
    [slots, epoch, dayCount]
  )

  return { epoch, dayCount, dayAt, dayIndexOf, slotsVersion }
}
