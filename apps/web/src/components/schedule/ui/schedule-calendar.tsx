// apps/web/src/components/schedule/ui/schedule-calendar.tsx
//
// The Schedule page's calendar view (plan plans/calendar/02-schedule-calendar-view.md §3.3) —
// `ModuleSidebar` (mini month calendar + a "Calendars" toggle group) beside a read-only
// `EventCalendar` grid, sourced from the `visits`/`meetings` calendar-source registry (plan
// 01-source-registry-refactor.md). No drag-move/resize/create (decision I′ — the schedule grid
// is display-only; scheduling stays the dispatch board's job) — `onEventClick` is the only
// click-through interaction, dispatched by `event.sourceId` to the click targets
// `schedule-page.tsx` owns (decision D′). Phase 6 (plan `37c-calendar-create-copy-paste.md` §8)
// adds the second layer on top of that: multi-select (free from the grid's generic selection
// engine) and visit copy/paste — copy is open to everyone, paste is admin/owner-gated because
// every dispatch write is `dispatchAdminProcedure`.

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import {
  type CalendarView,
  EventCalendar,
  type RenderEventContext,
} from '@auxx/ui/components/event-calendar'
import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import { toastError } from '@auxx/ui/components/toast'
import { useMemo, useState } from 'react'
import { hiddenIdsForGroup } from '~/components/calendar/core/source-visibility'
import type { CalendarSource, SourcedEvent } from '~/components/calendar/core/types'
import { useCalendarClipboard } from '~/components/calendar/core/use-calendar-clipboard'
import type { CalendarRangeView, DateRange } from '~/components/calendar/core/use-calendar-range'
import { meetingsSource } from '~/components/calendar/sources/meetings-source'
import type { TaskEvent } from '~/components/calendar/sources/tasks-source'
import { tasksSource } from '~/components/calendar/sources/tasks-source'
import { type VisitEvent, visitsSource } from '~/components/calendar/sources/visits-source'
import { MiniCalendarSection } from '~/components/calendar/ui/mini-calendar-section'
import {
  PasteVisitsDialog,
  type PasteWorkerOption,
} from '~/components/calendar/ui/paste-visits-dialog'
import { SourceToggleGroup } from '~/components/calendar/ui/source-toggle-group'
import { useResource } from '~/components/resources'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { useScheduleSidebarStore } from '../stores/schedule-sidebar-store'

/** Sidebar group id for the visits/meetings source toggle rows. */
const KINDS_GROUP = 'kinds'

/** Stable empty default — an inline `[]` would recreate `EventCalendar`'s `selectedIdSet` every
 * render whenever nothing is selected. */
const EmptySelection: string[] = []

/** The paste dialog's worker-retarget list — always empty on schedule (no per-worker resource
 * columns exist on this grid, so the "assign all to <worker>" option never applies); a stable
 * reference so `PasteVisitsDialog`'s memo doesn't recompute every render. */
const EmptyWorkers: PasteWorkerOption[] = []

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
  /** Event id whose detail drawer/sheet is open — only used to SEED the initial multi-selection
   * (below) so switching from list view with something already open still shows a ring on
   * mount; once mounted, selection is purely gesture-driven (plan 37c §8) and no longer
   * resynced from this prop (a plain click already keeps the two in lockstep — the grid's
   * selection engine calls `onSelectionChange([id])` on the very same click that opens the
   * drawer via `onEventClick`). */
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

  // Multi-selection (plan 37c §8) — grid-internal gesture layer (cmd/shift/marquee/day-grab/
  // Escape) comes free from `EventCalendar`'s generic selection engine; this is just the
  // controlled state it reads/writes. Seeded (not resynced) from `selectedEventId` — see the
  // prop's doc comment.
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>(() =>
    selectedEventId ? [selectedEventId] : []
  )

  const { isAdminOrOwner, userId } = useUser()
  const { resource: workOrderResource } = useResource('work-orders')
  const utils = api.useUtils()

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

  // Plain-click-only (plan 37c §3.2 — the grid never calls this on a modifier-click), so
  // behavior here is unchanged from before multi-selection/copy-paste landed.
  const handleEventClick = (event: SourcedEvent, _e: React.MouseEvent) => {
    if (event.sourceId === 'visits') onVisitClick(event.id)
    else if (event.sourceId === 'meetings') onMeetingClick(event.id)
    else if (event.sourceId === 'tasks') onTaskClick((event as TaskEvent).task)
  }

  // Copy (plan 37c §8): enabled for everyone, but only `sourceId === 'visits'` events are
  // clipboard-eligible — meetings/tasks have no work order to paste onto, so they're narrowed
  // out here rather than filtered a second time inside `useCalendarClipboard`. `workOrderId`
  // comes straight off `VisitEvent` (added alongside this phase); `assigneeUserId` isn't part of
  // the source's payload at all — `dispatch.myVisits` only ever returns the signed-in worker's
  // OWN visits, so it's always the current user, no need to round-trip it through the query.
  const visitClipboardEvents = useMemo(
    () =>
      events
        .filter((event): event is VisitEvent => event.sourceId === 'visits')
        .map((event) => ({
          id: event.id,
          workOrderId: event.workOrderId,
          title: event.title,
          start: event.start,
          end: event.end,
          assigneeUserId: userId,
        })),
    [events, userId]
  )

  const clipboard = useCalendarClipboard({
    events: visitClipboardEvents,
    selectedIds: selectedEventIds,
    anchorDate: date,
    workOrderDefId: workOrderResource?.id,
    canCopy: true,
    // Paste is admin/owner-only (every dispatch write is `dispatchAdminProcedure`) — non-admins
    // get no Cmd+V, no dialog, no affordance at all (plan 37c §8, derived decision).
    canPaste: isAdminOrOwner,
  })

  // No optimistic cache patch here (unlike the board's `use-board-mutations.ts` `pasteVisits`) —
  // this surface has no local cache shape to patch against; `dispatch.myVisits` invalidate on
  // settle is enough. It can't rely on the realtime `dispatch:visit-changed` broadcast alone: the
  // acting client's own socket id is excluded from its own broadcast (the board's optimistic
  // patch is what stands in for it there), and paste is only ever invoked BY this same client.
  const pasteVisits = api.dispatch.pasteVisits.useMutation({
    onSuccess: (result) => {
      if (result.failures.length > 0) {
        toastError({
          title: 'Some visits could not be pasted',
          description: `${result.failures.length} of ${result.created.length + result.failures.length} visits failed to paste`,
        })
      }
    },
    onError: (error) => toastError({ title: 'Error pasting visits', description: error.message }),
    onSettled: () => {
      void utils.dispatch.myVisits.invalidate()
    },
  })

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
        selectedEventIds={selectedEventIds.length > 0 ? selectedEventIds : EmptySelection}
        onSelectionChange={setSelectedEventIds}
        hoveredSlotRef={clipboard.hoveredSlotRef}
        weekStartsOn={weekStartsOn}
        hideToolbar
        className='flex-1'
      />
      {isAdminOrOwner && (
        <PasteVisitsDialog
          target={clipboard.pasteTarget}
          onOpenChange={(open) => {
            if (!open) clipboard.closePasteDialog()
          }}
          items={clipboard.clipboardItems ?? []}
          workers={EmptyWorkers}
          pasteVisits={pasteVisits}
        />
      )}
    </div>
  )
}
