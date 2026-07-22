// apps/web/src/components/dispatch/ui/board/hooks/use-visible-hour-window.ts

'use client'

import { useMemo } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

/** While loading, or when the org has no weekly-hours template at all. */
const FALLBACK_WINDOW = { start: 6, end: 20 }

const BUFFER_HOURS = 2

/** Anything with a start/end the window should be wide enough to show. */
interface WindowEvent {
  start: Date | string
  end?: Date | string | null
}

/** Local hour-of-day (fractional) of a date-ish value, or `null` if unparseable. */
function hourOfDay(value: Date | string | null | undefined): number | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  const ms = date.getTime()
  if (Number.isNaN(ms)) return null
  return date.getHours() + date.getMinutes() / 60
}

/**
 * The board time-grid views' visible hour window (plan 41): `[floor(minStart) − 2h, ceil(maxEnd) +
 * 2h]` over the org weekly working-hours template's enabled days, clamped to `[0, 24]`. An explicit
 * settings override (`dispatch.board.visibleHourStart`/`visibleHourEnd`) wins when BOTH keys are
 * numbers with `end > start`. Falls back to `{ start: 6, end: 20 }` while loading or when the
 * template is empty/absent.
 *
 * The resulting window is then *unioned* with the hour-of-day span of every passed `events` entry,
 * so a visit scheduled outside the configured band (e.g. a 1am job) always shows its hour — the
 * crop never clips real work. The union runs over the whole loaded event set rather than the
 * per-scroll visible range so the window (and thus the grid geometry) stays stable while scrolling.
 *
 * Feeds `EventCalendar`'s `hourWindow` prop, which crops the hour axis of the day/week/resource
 * vertical grids and the horizontal timeline alike. Shares its `availability.getWeeklyHours` query
 * (same input + `ORG_STATIC_STALE_TIME`) with `use-availability-shading.ts` so react-query dedupes.
 */
export function useVisibleHourWindow(events: WindowEvent[] = []): { start: number; end: number } {
  const orgWeekly = api.availability.getWeeklyHours.useQuery(
    { subject: { type: 'organization' } },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const overrideStart = getSetting('dispatch.board.visibleHourStart')
  const overrideEnd = getSetting('dispatch.board.visibleHourEnd')

  // Span of the loaded events, as whole-hour bounds — memoized on a cheap numeric digest so the
  // window only recomputes when the actual min/max hour changes, not on every events-array identity.
  const { eventMinHour, eventMaxHour } = useMemo(() => {
    let min: number | undefined
    let max: number | undefined
    for (const event of events) {
      const startHour = hourOfDay(event.start)
      if (startHour != null) min = min === undefined ? startHour : Math.min(min, startHour)
      const endHour = hourOfDay(event.end) ?? startHour
      if (endHour != null) max = max === undefined ? endHour : Math.max(max, endHour)
    }
    return {
      eventMinHour: min === undefined ? undefined : Math.max(0, Math.floor(min)),
      eventMaxHour: max === undefined ? undefined : Math.min(24, Math.ceil(max)),
    }
  }, [events])

  return useMemo(() => {
    let base: { start: number; end: number }

    if (
      typeof overrideStart === 'number' &&
      typeof overrideEnd === 'number' &&
      overrideEnd > overrideStart
    ) {
      // Whole hours only — the view's hour ticks and day width assume integer window bounds.
      base = {
        start: Math.max(0, Math.min(24, Math.round(overrideStart))),
        end: Math.max(0, Math.min(24, Math.round(overrideEnd))),
      }
    } else {
      const days = orgWeekly.data?.days ?? []
      let minStart: number | undefined
      let maxEnd: number | undefined
      for (const day of days) {
        for (const range of day.ranges) {
          minStart = minStart === undefined ? range.start : Math.min(minStart, range.start)
          maxEnd = maxEnd === undefined ? range.end : Math.max(maxEnd, range.end)
        }
      }
      if (minStart === undefined || maxEnd === undefined) {
        base = FALLBACK_WINDOW
      } else {
        // `range.start`/`range.end` are minutes-since-midnight; convert to hours before buffering.
        const start = Math.max(0, Math.floor(minStart / 60) - BUFFER_HOURS)
        const end = Math.min(24, Math.ceil(maxEnd / 60) + BUFFER_HOURS)
        base = end <= start ? FALLBACK_WINDOW : { start, end }
      }
    }

    // Auto-expand so a real visit outside the configured band is never clipped (plan 41 axis 1).
    const start = eventMinHour === undefined ? base.start : Math.min(base.start, eventMinHour)
    const end = eventMaxHour === undefined ? base.end : Math.max(base.end, eventMaxHour)
    return { start: Math.max(0, start), end: Math.min(24, Math.max(start + 1, end)) }
  }, [orgWeekly.data, overrideStart, overrideEnd, eventMinHour, eventMaxHour])
}
