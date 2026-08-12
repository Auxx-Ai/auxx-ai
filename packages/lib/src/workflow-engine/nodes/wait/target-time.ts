// packages/lib/src/workflow-engine/nodes/wait/target-time.ts
// Pure target-time resolution for the wait node's "wait until specific time" mode.
// Extracted into its own file so it's unit-testable without any workflow-engine/DB
// scaffolding, and to keep the timezone rule in ONE place.
//
// Uses the same `date-fns-tz` pattern as the sibling `delivery-window.ts` and
// `sequences/anchor.ts`: `fromZonedTime` reads a wall-clock string as local to the
// given IANA zone and returns the correct UTC instant (DST-aware).

import { fromZonedTime } from 'date-fns-tz'

/**
 * A trailing UTC designator or numeric offset — `Z`, `+02:00`, `-0500`.
 * When the author's value already pins an absolute instant there is nothing for a
 * timezone to reinterpret, and running it through `fromZonedTime` would shift it a
 * SECOND time (e.g. `2026-09-01T09:00:00Z` + `America/New_York` → 06:00Z, four hours
 * off). Those values are parsed as-is.
 */
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * Resolve a wait node's target time, honouring the node's configured timezone.
 *
 * A bare wall-clock string (`2026-09-01T09:00`, `2026-09-01 09:00`) carries no offset,
 * so `new Date(value)` would read it in the SERVER's timezone — which is why the
 * builder's timezone picker had no effect. With `timezone` set, the value is read as
 * wall-clock time in that zone instead.
 *
 * @param value - The resolved `time` config: an ISO/parseable string, a `Date`, or an
 *   epoch-milliseconds number.
 * @param timezone - Optional IANA timezone (e.g. `America/New_York`). Omitted/empty
 *   falls back to the server timezone, matching the panel's "If not specified, the
 *   account timezone will be used" note.
 * @returns The resolved instant. May be an Invalid Date — callers validate.
 */
export function resolveTargetTime(value: unknown, timezone?: string): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value !== 'string') return new Date(NaN)

  const trimmed = value.trim()
  if (!timezone || !trimmed || EXPLICIT_OFFSET.test(trimmed)) {
    return new Date(trimmed)
  }

  assertKnownTimezone(timezone)
  return fromZonedTime(trimmed, timezone)
}

/**
 * An unrecognised IANA zone makes `fromZonedTime` either throw an opaque
 * `RangeError: Invalid time value` or return an Invalid Date, depending on which build
 * of `date-fns-tz` is loaded. Neither is actionable, and silently falling back to the
 * server timezone would resolve to the WRONG instant — so reject it up front, where the
 * cause can be named.
 */
function assertKnownTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    throw new Error(`Unknown timezone "${timezone}" on wait node`)
  }
}
