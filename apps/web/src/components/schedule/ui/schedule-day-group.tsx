// apps/web/src/components/schedule/ui/schedule-day-group.tsx
//
// One sticky-header day section of the Schedule list (08-worker-surface.md §2 — the
// `mail-thread-list.tsx:462` sticky pattern, incl. its mask-fade classes).

'use client'

import { format, isToday } from 'date-fns'
import type { ScheduleDayGroup as ScheduleDayGroupData } from '../hooks/use-my-schedule'
import { ScheduleCard } from './schedule-card'

interface ScheduleDayGroupProps {
  group: ScheduleDayGroupData
  onMeetingClick: (meetingId: string) => void
}

export function ScheduleDayGroup({ group, onMeetingClick }: ScheduleDayGroupProps) {
  return (
    <div>
      <div className='sticky top-0 z-10 flex items-center gap-2 bg-secondary px-1 py-3 mask-b-from-80% mask-b-to-100% dark:bg-background sm:dark:bg-muted-50'>
        <span className='text-sm font-medium'>{format(group.date, 'EEEE, MMM d')}</span>
        {isToday(group.date) && (
          <span className='rounded-full bg-primary-200 px-2 py-0.5 text-xs text-primary-700'>
            Today
          </span>
        )}
      </div>
      <div className='flex flex-col gap-2 px-1 pb-4'>
        {group.items.map((item) => (
          <ScheduleCard
            key={`${item.kind}-${item.id}`}
            item={item}
            onMeetingClick={onMeetingClick}
          />
        ))}
      </div>
    </div>
  )
}
