// apps/web/src/components/schedule/ui/schedule-card.tsx
//
// One agenda row (08-worker-surface.md §2, user-specified anatomy): rounded card, a colored
// left accent bar (visit = status color; meeting = its own hue), a medium title, and a muted
// line-clamped time range. Both kinds call back to the page, which routes visits (mobile) or
// opens `VisitDrawer` (desktop) / `MeetingSheet`.

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import type { ScheduleItem } from '../hooks/use-my-schedule'

/** Left-bar accent per visit status — a status-color mirror of `VISIT_STATUS_BADGE_VARIANT`. */
const VISIT_STATUS_ACCENT: Record<string, string> = {
  scheduled: 'bg-blue-500',
  en_route: 'bg-amber-500',
  on_site: 'bg-teal-500',
  done: 'bg-green-500',
  canceled: 'bg-red-500',
}

/** Meetings get one fixed, distinct hue — they don't carry a status. */
const MEETING_ACCENT = 'bg-violet-500'

interface ScheduleCardProps {
  item: ScheduleItem
  onVisitClick: (visitId: string) => void
  onMeetingClick: (meetingId: string) => void
}

export function ScheduleCard({ item, onVisitClick, onMeetingClick }: ScheduleCardProps) {
  const accent =
    item.kind === 'visit'
      ? (VISIT_STATUS_ACCENT[item.status] ?? VISIT_STATUS_ACCENT.scheduled)
      : MEETING_ACCENT
  const timeRange = `${format(item.startTime, 'p')} – ${format(item.endTime, 'p')}`

  const handleClick = () => {
    if (item.kind === 'visit') {
      onVisitClick(item.id)
    } else {
      onMeetingClick(item.id)
    }
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      className='flex w-full items-stretch gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50'>
      <span className={cn('w-1 shrink-0 rounded-full', accent)} />
      <div className='min-w-0 flex-1 py-0.5'>
        <p className='truncate text-sm font-medium'>{item.title}</p>
        <p className='line-clamp-1 text-xs text-muted-foreground'>{timeRange}</p>
      </div>
    </button>
  )
}
