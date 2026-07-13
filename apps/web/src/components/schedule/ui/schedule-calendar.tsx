// apps/web/src/components/schedule/ui/schedule-calendar.tsx
//
// The Schedule page's calendar view (plan plans/calendar/02-schedule-calendar-view.md §3.3) —
// `ModuleSidebar` (mini month calendar + a "Calendars" toggle group) beside a read-only
// `EventCalendar` grid, sourced from the `visits`/`meetings` calendar-source registry (plan
// 01-source-registry-refactor.md). No drag-move/resize/create (decision I′ — the schedule grid
// is display-only; scheduling stays the dispatch board's job) — `onEventClick` is the only
// interaction, dispatched by `event.sourceId` to the click targets `schedule-page.tsx` owns
// (decision D′).

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import {
  type CalendarView,
  EventCalendar,
  type RenderEventContext,
} from '@auxx/ui/components/event-calendar'
import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import { useMemo } from 'react'
import { hiddenIdsForGroup } from '~/components/calendar/core/source-visibility'
import type { CalendarSource, SourcedEvent } from '~/components/calendar/core/types'
import type { CalendarRangeView, DateRange } from '~/components/calendar/core/use-calendar-range'
import { meetingsSource } from '~/components/calendar/sources/meetings-source'
import type { TaskEvent } from '~/components/calendar/sources/tasks-source'
import { tasksSource } from '~/components/calendar/sources/tasks-source'
import { visitsSource } from '~/components/calendar/sources/visits-source'
import { MiniCalendarSection } from '~/components/calendar/ui/mini-calendar-section'
import { SourceToggleGroup } from '~/components/calendar/ui/source-toggle-group'
import { useSettings } from '~/hooks/use-settings'
import { useScheduleSidebarStore } from '../stores/schedule-sidebar-store'

/** Sidebar group id for the visits/meetings source toggle rows. */
const KINDS_GROUP = 'kinds'

/**
 * Module-level static source list — hook rules require a page's source list never change
 * across renders (plan 01 §3.1), so this lives outside the component.
 *
 * Variance: `CalendarSource<VisitEvent>` isn't assignable to `CalendarSource<SourcedEvent>`
 * (`renderEvent`'s param is contravariant); the cast is safe because every event carries the
 * `sourceId` of the source that produced it, so it's always routed back to that same source's
 * `renderEvent` (see `renderEvent` below) — never to a different source's narrower type.
 */
const SOURCES = [
  visitsSource,
  meetingsSource,
  tasksSource,
] as unknown as CalendarSource<SourcedEvent>[]

const SOURCE_BY_ID: Record<string, CalendarSource<SourcedEvent>> = Object.fromEntries(
  SOURCES.map((source) => [source.descriptor.id, source])
)

/** A `SettingValue` read via `getSetting` may be a scalar or (defensively) a 1-item array — same
 * helper as the dispatch board's (`dispatch/ui/board/utils.ts`'s `scalarSetting`), duplicated
 * here rather than imported so the schedule module doesn't reach into dispatch's board tree. */
function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

interface ScheduleCalendarProps {
  date: Date
  onDateChange: (date: Date) => void
  view: CalendarRangeView
  range: DateRange
  onRangeChange: (from: Date, to: Date) => void
  onViewChange: (view: CalendarRangeView) => void
  onVisitClick: (visitId: string) => void
  onMeetingClick: (meetingId: string) => void
  onTaskClick: (task: TaskEvent['task']) => void
  /** Event id whose detail drawer/sheet is open — draws the in-color selection ring. */
  selectedEventId?: string | null
}

/**
 * The desktop calendar view — mounted by `schedule-page.tsx` only for the three grid views
 * (list stays `ScheduleList`) and never on mobile (decision G′).
 */
export function ScheduleCalendar({
  date,
  onDateChange,
  view,
  range,
  onRangeChange,
  onViewChange,
  onVisitClick,
  onMeetingClick,
  onTaskClick,
  selectedEventId,
}: ScheduleCalendarProps) {
  const open = useScheduleSidebarStore((s) => s.open)
  const setOpen = useScheduleSidebarStore((s) => s.setOpen)
  const groupOpen = useScheduleSidebarStore((s) => s.groupOpen)
  const setGroupOpen = useScheduleSidebarStore((s) => s.setGroupOpen)
  const hidden = useScheduleSidebarStore((s) => s.hidden)
  const toggleHidden = useScheduleSidebarStore((s) => s.toggleHidden)

  const hiddenIds = hiddenIdsForGroup(hidden, KINDS_GROUP)

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)

  // Every source's hook runs unconditionally, in the same order, on every render — safe only
  // because `SOURCES` is the module-level static array above, never recomputed per mount.
  // A hidden source still gets `enabled: false` so the shell's own query is skipped.
  const sourceData = SOURCES.map((source) =>
    source.useEvents(range, !hiddenIds.includes(source.descriptor.id))
  )

  // Merge visible sources' events. Filtering here (not just via `enabled`) matters — react
  // query keeps a disabled query's last-fetched data around, so a toggled-off source's
  // `events` array can still be non-empty; the merge is the actual visibility gate.
  const events = useMemo<SourcedEvent[]>(() => {
    const merged: SourcedEvent[] = []
    SOURCES.forEach((source, index) => {
      if (hiddenIds.includes(source.descriptor.id)) return
      merged.push(...sourceData[index]!.events)
    })
    return merged
  }, [sourceData, hiddenIds])

  const renderEvent = (event: SourcedEvent, ctx: RenderEventContext) =>
    SOURCE_BY_ID[event.sourceId]?.renderEvent(event, ctx) ?? null

  const handleEventClick = (event: SourcedEvent) => {
    if (event.sourceId === 'visits') onVisitClick(event.id)
    else if (event.sourceId === 'meetings') onMeetingClick(event.id)
    else if (event.sourceId === 'tasks') onTaskClick((event as TaskEvent).task)
  }

  // The grid's keyboard shortcuts (`EventCalendar`'s M/W/D/A) can emit 'agenda'/'resource' too —
  // this shell only ever offers day/week/month, so filter those out before forwarding.
  const handleViewChange = (nextView: CalendarView) => {
    if (nextView === 'day' || nextView === 'week' || nextView === 'month') onViewChange(nextView)
  }

  const toggleItems = SOURCES.map((source) => ({
    id: source.descriptor.id,
    label: source.descriptor.label,
    color: source.descriptor.color,
  }))

  return (
    <div className='flex flex-1 overflow-hidden'>
      <ModuleSidebar open={open} onOpenChange={setOpen}>
        <MiniCalendarSection
          date={date}
          onDateChange={onDateChange}
          visibleRange={range}
          weekStartsOn={weekStartsOn}
        />
        <SourceToggleGroup
          title='Calendars'
          items={toggleItems}
          open={groupOpen[KINDS_GROUP] ?? true}
          onOpenChange={(o) => setGroupOpen(KINDS_GROUP, o)}
          isHidden={(id) => hiddenIds.includes(id)}
          onToggle={(id) => toggleHidden(KINDS_GROUP, id)}
        />
      </ModuleSidebar>
      <EventCalendar<SourcedEvent>
        date={date}
        view={view}
        onDateChange={onDateChange}
        onViewChange={handleViewChange}
        onRangeChange={onRangeChange}
        events={events}
        renderEvent={renderEvent}
        onEventClick={handleEventClick}
        selectedEventId={selectedEventId}
        weekStartsOn={weekStartsOn}
        hideToolbar
        className='flex-1'
      />
    </div>
  )
}
