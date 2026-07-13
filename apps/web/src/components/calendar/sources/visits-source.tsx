// apps/web/src/components/calendar/sources/visits-source.tsx
//
// Calendar source for the signed-in user's visits (`dispatch.myVisits`) — plan
// plans/calendar/02-schedule-calendar-view.md §3.1, moved + completed from the dispatch board's
// descriptor-only stub. Not `getBoard` — the schedule page's personal calendar reads the
// member-scoped `myVisits` query, not the org-wide board (plan 01 §6). Dispatch's own
// grid/renderEvent/popover wiring (`board/utils.ts`'s `visitToEvent`) is untouched by this file.

'use client'

import { format } from 'date-fns'
import { useCallback, useMemo } from 'react'
import type { CalendarSource, SourcedEvent } from '~/components/calendar/core/types'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'

type MyVisit = RouterOutputs['dispatch']['myVisits'][number]

/** Emerald-500 — the visits source's default toggle-dot/chip color (decision D: color is per-surface). */
const VISITS_COLOR = '#10b981'

/** A `dispatch.myVisits` row mapped onto the shared event shape. */
export interface VisitEvent extends SourcedEvent {
  status: MyVisit['status']
}

/**
 * Visit title convention shared by every surface that lists `myVisits` rows: `"number ·
 * displayName"` when the work order has a number, otherwise just the display name (falling
 * back to `'Work order'` when neither is set). Lives here (not `use-my-schedule.ts`) because
 * this source owns the visit-row-to-title mapping; the schedule list hook imports it back.
 */
export function visitTitle(visit: Pick<MyVisit, 'workOrder'>): string {
  const { number, displayName } = visit.workOrder
  return number ? `${number} · ${displayName ?? 'Work order'}` : (displayName ?? 'Work order')
}

/**
 * Calendar source for the signed-in user's visits. Descriptor buckets it into the `'kinds'`
 * sidebar group alongside `meetings` (decision B); `useEvents` reads the range-windowed
 * `dispatch.myVisits` query and is skipped entirely via `enabled` when the source is hidden.
 * Realtime: any `dispatch:visit-changed` broadcast on the org channel invalidates the visible
 * range's query — the same rule `use-my-schedule.ts` uses for its fixed ±4wk window.
 */
export const visitsSource: CalendarSource<VisitEvent> = {
  descriptor: {
    id: 'visits',
    label: 'Visits',
    group: 'kinds',
    color: VISITS_COLOR,
  },

  useEvents: (range, enabled) => {
    const query = api.dispatch.myVisits.useQuery(
      { from: range.from, to: range.to },
      { enabled, placeholderData: (prev) => prev }
    )

    const utils = api.useUtils()
    const onEvent = useCallback(
      (event: string) => {
        if (event !== 'dispatch:visit-changed') return
        void utils.dispatch.myVisits.invalidate({ from: range.from, to: range.to })
      },
      [utils, range.from, range.to]
    )
    useOrgChannel({ onEvent })

    const events = useMemo<VisitEvent[]>(
      () =>
        (query.data ?? []).map((visit) => ({
          id: visit.id,
          title: visitTitle(visit),
          start: visit.startTime,
          end: visit.endTime,
          color: VISITS_COLOR,
          sourceId: 'visits',
          status: visit.status,
        })),
      [query.data]
    )

    return { events, isLoading: query.isLoading }
  },

  renderEvent: (event, ctx) => (
    <div className='flex h-full w-full min-w-0 items-center gap-1 overflow-hidden px-1'>
      <span className='min-w-0 flex-1 truncate text-[10px] font-semibold sm:text-xs'>
        {event.title}
      </span>
      {ctx.view !== 'month' && (
        <span className='shrink-0 text-[10px] font-normal opacity-70'>
          {format(event.start, 'p')}
        </span>
      )}
    </div>
  ),
}
