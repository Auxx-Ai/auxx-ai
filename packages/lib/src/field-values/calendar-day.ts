// packages/lib/src/field-values/calendar-day.ts

/**
 * Calendar-day helpers for `FieldType.DATE`.
 *
 * A DATE value is a calendar day. Its canonical storage is `YYYY-MM-DDT00:00:00.000Z`,
 * and every reader slices or formats it in UTC. These helpers are the single
 * implementation of that rule, shared by the server normalisers (converter and
 * validator) and the browser doors (picker, grid paste, filter picker).
 *
 * Contract: plans/money/tasks/33-calendar-day-fields.md §3.
 */

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const HALF_DAY_MS = DAY_MS / 2

/**
 * The picked `Date`'s local calendar day as the canonical UTC-midnight ISO string.
 *
 * Browser doors use this so the viewer's zone never crosses the wire: a UTC+2 user
 * picking May 10 sends `2026-05-10T00:00:00.000Z`, not `2026-05-09T22:00:00.000Z`.
 */
export function toCalendarDayIso(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}T00:00:00.000Z`
}

/**
 * A local `Date` at local midnight of the stored value's UTC calendar day, so a
 * calendar highlights the day that was stored regardless of the viewer's zone.
 *
 * Returns `undefined` for an empty or unparseable value.
 */
export function fromCalendarDayIso(value: unknown): Date | undefined {
  const iso = normalizeCalendarDayIso(value)
  if (!iso) return undefined
  const utc = new Date(iso)
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
}

/**
 * Normalise any DATE input to the canonical UTC-midnight ISO string.
 *
 * - a bare `YYYY-MM-DD` is that day at midnight UTC;
 * - any other parseable instant (ISO with time or offset, a `Date`, an epoch number)
 *   rounds to the **nearest** UTC midnight, so a local-midnight instant from either
 *   side of UTC and an offset form like `T00:00:00+02:00` all land on the intended day;
 * - empty or unparseable input returns `null`.
 *
 * Nearest rather than truncate is deliberate: truncation is off by one for every
 * writer east of UTC.
 */
export function normalizeCalendarDayIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return roundToUtcMidnight(value.getTime())
  if (typeof value === 'number') return roundToUtcMidnight(value)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed === '') return null
  if (BARE_DAY.test(trimmed)) {
    return roundToUtcMidnight(new Date(`${trimmed}T00:00:00.000Z`).getTime())
  }
  return roundToUtcMidnight(new Date(trimmed).getTime())
}

/** The nearest UTC midnight to an epoch instant, or `null` when it is not a number. */
function roundToUtcMidnight(epochMs: number): string | null {
  if (Number.isNaN(epochMs)) return null
  return new Date(Math.floor((epochMs + HALF_DAY_MS) / DAY_MS) * DAY_MS).toISOString()
}
