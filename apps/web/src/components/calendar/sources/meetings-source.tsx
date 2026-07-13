// apps/web/src/components/calendar/sources/meetings-source.tsx
//
// Calendar source for the signed-in user's meetings (`calendar.myMeetings`) — plan
// plans/calendar/01-source-registry-refactor.md §4 Phase 3, the honesty check that the
// `CalendarSource` contract holds for a source whose query isn't dispatch's `getBoard`. Not
// mounted anywhere yet; the `/app/calendar` page plan is the first consumer.

'use client'

import { format } from 'date-fns'
import { useMemo } from 'react'
import type { CalendarSource, SourcedEvent } from '~/components/calendar/core/types'
import { api } from '~/trpc/react'

/** Sky-500 — the meetings source's default toggle-dot/chip color (decision D: color is per-surface). */
const MEETINGS_COLOR = '#0ea5e9'

/**
 * A `calendar.myMeetings` row mapped onto the shared event shape. `meetingUrl` rides along on
 * the event for a later chip iteration (the plan defers rendering it as a link) — everything
 * else in `MyMeetingListItem` (`title`/`startTime`/`endTime`) is required, so no fallback
 * mapping is needed here.
 */
export interface MeetingEvent extends SourcedEvent {
  meetingUrl: string | null
}

/**
 * Calendar source for the signed-in user's meetings. Descriptor buckets it into the `'kinds'`
 * sidebar group alongside `visits` (decision B); `useEvents` reads the already range-windowed
 * `calendar.myMeetings` query and is skipped entirely via `enabled` when the source is hidden.
 */
export const meetingsSource: CalendarSource<MeetingEvent> = {
  descriptor: {
    id: 'meetings',
    label: 'Meetings',
    group: 'kinds',
    color: MEETINGS_COLOR,
  },

  useEvents: (range, enabled) => {
    const query = api.calendar.myMeetings.useQuery(
      { from: range.from, to: range.to },
      { enabled, placeholderData: (prev) => prev }
    )

    const events = useMemo<MeetingEvent[]>(
      () =>
        (query.data ?? []).map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          start: meeting.startTime,
          end: meeting.endTime,
          color: MEETINGS_COLOR,
          sourceId: 'meetings',
          meetingUrl: meeting.meetingUrl,
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
