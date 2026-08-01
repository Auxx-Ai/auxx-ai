// packages/lib/src/ai/kopilot/prompts/sections/now.ts

import { ALL_MODES, type PromptSection } from './types'

/** Zone used when the turn carries none. See {@link nowSection} for why. */
const FALLBACK_TIME_ZONE = 'UTC'

/**
 * Render `Friday, 31 July 2026` in `timeZone`. `en-GB` is chosen for the
 * unambiguous day-month-year order (an American `7/31/2026` and a European
 * `31/7/2026` are indistinguishable to a model reading a numeric date).
 */
function formatLongDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
}

/** Render `14:05` in `timeZone` — 24h, so there is no am/pm to misread. */
function formatTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

/** Render `2026-07-31` — the calendar date in `timeZone`, not the UTC date. */
function formatIsoDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * The turn's clock.
 *
 * Without this section the model has no date at all: it answers "tickets from
 * last week" against whatever its training data suggests today is, and every
 * relative date it passes to a tool is a guess. This is `stability: 'turn'` and
 * MUST stay in the tier-3 block of the registry — a `static`/`org` section is
 * cached across calls, so the date would be frozen at whatever it was when the
 * cache entry was written.
 *
 * **Zone resolution is org → user → UTC, and the org tier is a documented
 * no-op.** Nothing stores an org zone: `SETTINGS_CATALOG`
 * (`lib/settings/catalog.ts`) has no timezone key and the `Organization` table
 * has no timezone column, so the `orgSettings`/`orgProfile` cache keys have
 * nothing to carry. No column or setting was invented to fill the tier — when
 * one is added, it slots in ahead of the user value at the `PromptCtx.timezone`
 * call site (`agents/agent.ts`), not here.
 *
 * The user tier is live: `User.preferredTimezone` rides the org `members` cache
 * projection and is threaded by `hydrateCaller` in `agents/agent.ts`. A caller
 * with no member row, no saved preference, or an unparseable zone renders UTC.
 */
export const nowSection: PromptSection = {
  id: 'now',
  modes: ALL_MODES,
  stability: 'turn',
  render: (ctx) => {
    const now = new Date()
    let timeZone = ctx.timezone?.trim() || FALLBACK_TIME_ZONE
    let longDate: string
    let time: string
    let isoDate: string
    try {
      longDate = formatLongDate(now, timeZone)
      time = formatTime(now, timeZone)
      isoDate = formatIsoDate(now, timeZone)
    } catch {
      // Invalid IANA zone — `Intl` throws rather than degrading. A wrong clock
      // is worse than a UTC one, so fall back instead of dropping the section.
      timeZone = FALLBACK_TIME_ZONE
      longDate = formatLongDate(now, timeZone)
      time = formatTime(now, timeZone)
      isoDate = formatIsoDate(now, timeZone)
    }

    return `## Current date and time

Right now it is **${longDate}, ${time}** in timezone **${timeZone}**. Today's date in ISO 8601 is \`${isoDate}\`.

This clock is authoritative. Resolve every relative date phrase — "today", "yesterday", "last week", "this month", "in the last 3 days" — against it, never against a date from your training data or from a timestamp in retrieved content. When a tool takes a date, pass ISO 8601 (\`YYYY-MM-DD\`) computed from the date above.`
  },
}
