// apps/web/src/components/calendar/core/clipboard-offset.ts
//
// Pure paste-anchor offset math (plan `37c-calendar-create-copy-paste.md` §4.2). No React, no
// store reads — `computePasteTimes` is unit-tested directly (`clipboard-offset.test.ts`).

import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  set,
  startOfDay,
} from 'date-fns'
import type { CopiedVisitItem } from './clipboard-store'

/** Where a paste lands. `time` is only present for a timed-slot target (right-clicked/hovered
 * a week/day/timeline cell); a month-view or day-only target omits it. */
export interface PasteTarget {
  day: Date
  time?: Date
}

export interface PasteTimesOptions {
  /** §4.3 "start at clicked slot" toggle — only meaningful (and only ever passed `true`) when
   * `target.time` is set; timed slots only. */
  startAtSlot: boolean
}

/** One item's computed paste time, paired back with the source item it came from (callers zip
 * this against `item.visitId`/`item.workOrderRecordId` for the mutation payload). */
export interface PasteTimeResult {
  item: CopiedVisitItem
  startTime: Date
  endTime: Date
}

/** Fractional-hours (`HoveredSlot.time`'s convention — e.g. `9.25` for 9:15) → a `Date` on the
 * given day, hour/minute-precision. Pure conversion helper shared by anything that needs to
 * turn a hovered/right-clicked slot into a `PasteTarget.time`. */
export function hoursToDate(day: Date, hours: number): Date {
  const wholeHours = Math.floor(hours)
  const minutes = Math.round((hours - wholeHours) * 60)
  return set(day, { hours: wholeHours, minutes, seconds: 0, milliseconds: 0 })
}

/**
 * §4.2's offset math: anchor day = start-of-day of the EARLIEST copied item (by `start`); every
 * item shifts by the same `dayDelta` (target day − anchor day, in calendar days) via
 * `date-fns#addDays` — NOT millisecond arithmetic, so a paste across a DST boundary keeps each
 * item's wall-clock time-of-day instead of drifting by an hour. Relative day structure and
 * durations both fall out of applying one delta to every item's `start`/`end`: a copied Mon+Wed
 * pair pasted on a Thursday becomes Thu+Sat.
 *
 * When `opts.startAtSlot` and `target.time` are both set, an additional shift is layered on top
 * (also via `date-fns#addMinutes`, so it composes with the day shift instead of re-deriving from
 * scratch): the EARLIEST item's start moves onto the slot's hour/minute, and every item — the
 * earliest included — carries the same extra delta, so relative offsets between items survive.
 *
 * Order of the returned array mirrors `items` (not chronological) — callers zip it back against
 * the original list for a preview table or a mutation payload.
 */
export function computePasteTimes(
  items: CopiedVisitItem[],
  target: PasteTarget,
  opts: PasteTimesOptions
): PasteTimeResult[] {
  if (items.length === 0) return []

  let anchorItem = items[0]!
  for (const item of items) {
    if (item.start.getTime() < anchorItem.start.getTime()) anchorItem = item
  }
  const anchorDay = startOfDay(anchorItem.start)
  const targetDay = startOfDay(target.day)
  const dayDelta = differenceInCalendarDays(targetDay, anchorDay)

  let extraMinutes = 0
  if (opts.startAtSlot && target.time) {
    const shiftedAnchorStart = addDays(anchorItem.start, dayDelta)
    const desiredAnchorStart = set(shiftedAnchorStart, {
      hours: target.time.getHours(),
      minutes: target.time.getMinutes(),
      seconds: target.time.getSeconds(),
      milliseconds: 0,
    })
    extraMinutes = differenceInMinutes(desiredAnchorStart, shiftedAnchorStart)
  }

  return items.map((item) => {
    const dayShiftedStart = addDays(item.start, dayDelta)
    const dayShiftedEnd = addDays(item.end, dayDelta)
    return {
      item,
      startTime: extraMinutes !== 0 ? addMinutes(dayShiftedStart, extraMinutes) : dayShiftedStart,
      endTime: extraMinutes !== 0 ? addMinutes(dayShiftedEnd, extraMinutes) : dayShiftedEnd,
    }
  })
}
