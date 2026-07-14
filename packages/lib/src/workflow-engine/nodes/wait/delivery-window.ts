// packages/lib/src/workflow-engine/nodes/wait/delivery-window.ts
// Pure delivery-window snapping math for the wait node (Sequences plan §3.3 —
// "Delivery-window math lives in the wait processor"). Extracted into its own
// file so it's unit-testable without any workflow-engine/DB scaffolding.
//
// Uses the repo's established `date-fns` + `date-fns-tz` pattern (see
// `dispatch/recurring/materialize.ts`, `recurrence/expand.ts`): `toZonedTime`
// projects a UTC instant onto the *local* (system-timezone) Date getters/
// setters so wall-clock math (`getHours`, `setHours`, `addDays`, weekday
// checks) reads/writes the target IANA zone's wall clock; `fromZonedTime`
// converts that wall-clock Date back to the correct UTC instant. This assumes
// the process runs with `TZ=UTC` (the deployed convention already relied on
// by the sibling modules above), so local getters double as UTC getters.

import { addDays, setHours, setMilliseconds, setMinutes, setSeconds } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

/** A sequence's per-send delivery window (`Sequence.delivery*` columns, §3.4). */
export interface DeliveryWindow {
  /** `HH:MM`, 24h, local to `timezone`. */
  startTime: string
  /** `HH:MM`, 24h, local to `timezone`. Inclusive end — a resume exactly at
   * `endTime` is still in-window; anything later snaps to the next day. */
  endTime: string
  /** IANA timezone, e.g. `America/New_York`. */
  timezone: string
  /** Skip Saturday/Sunday — snap forward to the next Monday. */
  businessDaysOnly: boolean
}

/** Parse an `HH:MM` string into `[hours, minutes]`, defaulting missing parts to 0. */
function parseHHMM(value: string): [number, number] {
  const [h, m] = value.split(':').map((part) => Number(part))
  return [h ?? 0, m ?? 0]
}

/** Set the wall-clock time-of-day on a (zoned-projected) Date, zeroing seconds/ms. */
function atTime(date: Date, hours: number, minutes: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(date, hours), minutes), 0), 0)
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * Snap `resumeAt` (a computed UTC instant — `now + delay`) FORWARD to the next
 * in-window moment per `window`, evaluated in `window.timezone` wall-clock
 * time. Pure — no I/O, no `Date.now()`.
 *
 * Rules:
 *  - before `startTime` on the same (valid) day → that day at `startTime`
 *  - after `endTime` (inclusive boundary) → the next day at `startTime`
 *  - inside `[startTime, endTime]` on a valid day → unchanged
 *  - `businessDaysOnly` and the landing day is Sat/Sun → roll forward,
 *    day-by-day, to the next Monday at `startTime` (handles the Friday-
 *    evening-after-window + weekend-before-window cases uniformly, including
 *    across a DST transition landing on the rolled-to day)
 */
export function snapToDeliveryWindow(resumeAt: Date, window: DeliveryWindow): Date {
  const { startTime, endTime, timezone, businessDaysOnly } = window
  const [startH, startM] = parseHHMM(startTime)
  const [endH, endM] = parseHHMM(endTime)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  let zoned = toZonedTime(resumeAt, timezone)
  const minutesOfDay = zoned.getHours() * 60 + zoned.getMinutes()

  if (minutesOfDay < startMinutes) {
    zoned = atTime(zoned, startH, startM)
  } else if (minutesOfDay > endMinutes) {
    zoned = atTime(addDays(zoned, 1), startH, startM)
  }
  // else: already inside the window — leave the instant unchanged.

  if (businessDaysOnly) {
    while (isWeekend(zoned)) {
      zoned = atTime(addDays(zoned, 1), startH, startM)
    }
  }

  return fromZonedTime(zoned, timezone)
}
