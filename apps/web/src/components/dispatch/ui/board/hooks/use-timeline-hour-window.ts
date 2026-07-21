// apps/web/src/components/dispatch/ui/board/hooks/use-timeline-hour-window.ts

'use client'

import { useMemo } from 'react'
import { useSettings } from '~/hooks/use-settings'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'

/** While loading, or when the org has no weekly-hours template at all. */
const FALLBACK_WINDOW = { start: 6, end: 20 }

const BUFFER_HOURS = 2

/**
 * The Timeline board view's hour window (plan 33 §2.2): `[floor(minStart) − 2h, ceil(maxEnd) +
 * 2h]` over the org weekly working-hours template's enabled days, clamped to `[0, 24]`. An
 * explicit settings override (`dispatch.board.timelineStartHour`/`timelineEndHour`) wins when
 * BOTH keys are set to numbers with `end > start`. Falls back to `{ start: 6, end: 20 }` while
 * loading or when the template is empty/absent.
 *
 * Queries `availability.getWeeklyHours` with the same input as
 * `use-availability-shading.ts`'s `orgWeekly` query and the same `ORG_STATIC_STALE_TIME`, so
 * react-query dedupes the two callers into one request/cache entry.
 */
export function useTimelineHourWindow(): { start: number; end: number } {
  const orgWeekly = api.availability.getWeeklyHours.useQuery(
    { subject: { type: 'organization' } },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const overrideStart = getSetting('dispatch.board.timelineStartHour')
  const overrideEnd = getSetting('dispatch.board.timelineEndHour')

  return useMemo(() => {
    if (
      typeof overrideStart === 'number' &&
      typeof overrideEnd === 'number' &&
      overrideEnd > overrideStart
    ) {
      // Whole hours only — the view's hour ticks and day width assume integer window bounds.
      return {
        start: Math.max(0, Math.min(24, Math.round(overrideStart))),
        end: Math.max(0, Math.min(24, Math.round(overrideEnd))),
      }
    }

    const days = orgWeekly.data?.days ?? []
    let minStart: number | undefined
    let maxEnd: number | undefined
    for (const day of days) {
      for (const range of day.ranges) {
        minStart = minStart === undefined ? range.start : Math.min(minStart, range.start)
        maxEnd = maxEnd === undefined ? range.end : Math.max(maxEnd, range.end)
      }
    }
    if (minStart === undefined || maxEnd === undefined) return FALLBACK_WINDOW

    // `range.start`/`range.end` are minutes-since-midnight; convert to hours before buffering.
    const start = Math.max(0, Math.floor(minStart / 60) - BUFFER_HOURS)
    const end = Math.min(24, Math.ceil(maxEnd / 60) + BUFFER_HOURS)
    if (end <= start) return FALLBACK_WINDOW
    return { start, end }
  }, [orgWeekly.data, overrideStart, overrideEnd])
}
