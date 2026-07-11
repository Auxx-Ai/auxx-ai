// apps/web/src/components/schedule/ui/schedule-list.tsx
//
// The Schedule page's bespoke grouped list (08-worker-surface.md §2 — deliberately NOT the
// `event-calendar` agenda view, whose day header is absolute-positioned rather than sticky).
// Only days that actually have a visit or meeting render a group, so prev/next/Today just
// step through this array's index and scroll the target group into view — no filtering.

'use client'

import { ScrollArea, scrollElementIntoViewport } from '@auxx/ui/components/scroll-area'
import { CalendarClock } from 'lucide-react'
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import type { ScheduleDayGroup as ScheduleDayGroupData } from '../hooks/use-my-schedule'
import { ScheduleDayGroup } from './schedule-day-group'

export interface ScheduleListHandle {
  scrollToToday: () => void
  scrollToPrevious: () => void
  scrollToNext: () => void
}

interface ScheduleListProps {
  groups: ScheduleDayGroupData[]
  todayIndex: number
  onMeetingClick: (meetingId: string) => void
}

export const ScheduleList = forwardRef<ScheduleListHandle, ScheduleListProps>(function ScheduleList(
  { groups, todayIndex, onMeetingClick },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dayNodes = useRef(new Map<string, HTMLDivElement>())
  const cursorRef = useRef(todayIndex)

  const scrollToIndex = useCallback(
    (index: number) => {
      if (groups.length === 0) return
      const clamped = Math.min(Math.max(index, 0), groups.length - 1)
      cursorRef.current = clamped
      const group = groups[clamped]
      const node = group && dayNodes.current.get(group.dayKey)
      const viewport = viewportRef.current
      if (node && viewport) scrollElementIntoViewport(node, viewport, { behavior: 'smooth' })
    },
    [groups]
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToToday: () => scrollToIndex(todayIndex),
      scrollToPrevious: () => scrollToIndex(cursorRef.current - 1),
      scrollToNext: () => scrollToIndex(cursorRef.current + 1),
    }),
    [todayIndex, scrollToIndex]
  )

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title='Nothing scheduled'
        description='No visits or meetings in the next few weeks.'
      />
    )
  }

  return (
    <ScrollArea className='h-full' viewportRef={viewportRef} noFade>
      <div className='flex flex-col gap-1 p-3'>
        {groups.map((group) => (
          <div
            key={group.dayKey}
            ref={(el) => {
              if (el) dayNodes.current.set(group.dayKey, el)
              else dayNodes.current.delete(group.dayKey)
            }}>
            <ScheduleDayGroup group={group} onMeetingClick={onMeetingClick} />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
})
