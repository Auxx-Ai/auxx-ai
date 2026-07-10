// apps/web/src/components/dispatch/ui/board/dispatch-board.tsx

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { CalendarDndProvider } from '@auxx/ui/components/event-calendar'
import type { DragEndEvent } from '@dnd-kit/core'
import { addMinutes } from 'date-fns'
import { Lock } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { BacklogRail } from './backlog-rail'
import { BoardCalendarGrid } from './board-calendar-grid'
import { BoardToolbar } from './board-toolbar'
import { useAvailabilityShading } from './hooks/use-availability-shading'
import { useBoardData } from './hooks/use-board-data'
import { useBoardMutations } from './hooks/use-board-mutations'
import { useBoardRealtime } from './hooks/use-board-realtime'
import type { DispatchVisitEvent } from './types'
import { UNASSIGNED_RESOURCE_ID } from './types'
import { computeOverlappingVisitIds, scalarSetting } from './utils'
import { VisitChipContent } from './visit-chip-content'

/**
 * The dispatch board (07-m2-build.md §D.2) — the `/app/dispatch` module home. Day view is
 * `resources` mode (workers + a first "Unassigned" column); week shows every worker
 * color-coded; month is display-only. All writes funnel through `dispatch.scheduleVisit`
 * (drag/resize/rail-drop) or the chip popover's status/dispatch mutations.
 */
export function DispatchBoard() {
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  const canEdit = isAdminOrOwner

  const data = useBoardData()
  const mutations = useBoardMutations(data.range)
  useBoardRealtime(data.range)

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)

  const workerUserIds = useMemo(() => data.workers.map((w) => w.userId), [data.workers])
  const backgroundEvents = useAvailabilityShading({
    view: data.view,
    range: data.range,
    workerUserIds,
  })

  const overlappingIds = useMemo(() => computeOverlappingVisitIds(data.events), [data.events])

  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)

  const existingVisits: ExistingVisitForOverlap[] = useMemo(
    () =>
      data.allEvents.map((e) => ({
        id: e.id,
        label: e.workOrder?.number ?? e.title,
        startTime: e.start,
        endTime: e.end,
        assigneeUserId: e.assigneeUserId,
      })),
    [data.allEvents]
  )

  const handleEventDrop = useCallback(
    (event: DispatchVisitEvent, newStart: Date, newEnd: Date, resourceId?: string) => {
      if (data.view === 'month') return
      const assigneeUserId =
        resourceId !== undefined
          ? resourceId === UNASSIGNED_RESOURCE_ID
            ? null
            : resourceId
          : undefined
      mutations.scheduleVisit.mutate({
        visitId: event.id,
        startTime: newStart,
        endTime: newEnd,
        assigneeUserId,
      })
    },
    [data.view, mutations.scheduleVisit]
  )

  const handleEventResize = useCallback(
    (event: DispatchVisitEvent, newEnd: Date) => {
      mutations.scheduleVisit.mutate({
        visitId: event.id,
        startTime: event.start,
        endTime: newEnd,
        assigneeUserId: event.assigneeUserId,
      })
    },
    [mutations.scheduleVisit]
  )

  // The backlog rail's draggables aren't calendar events — `CalendarDndProvider`'s escape
  // hatch hands us the raw dnd-kit event so we can interpret the drop ourselves (07 §D.2).
  const handleForeignDragEnd = useCallback(
    (dragEvent: DragEndEvent) => {
      const activeData = dragEvent.active.data.current as
        | { type?: string; visitId?: string }
        | undefined
      if (activeData?.type !== 'backlog-visit' || !activeData.visitId) return

      const overData = dragEvent.over?.data.current as
        | { date?: Date; time?: number; resourceId?: string }
        | undefined
      if (!overData?.date || overData.time === undefined) return // no drop target, or a month cell

      const startTime = new Date(overData.date)
      const hours = Math.floor(overData.time)
      const minutes = Math.round((overData.time - hours) * 60)
      startTime.setHours(hours, minutes, 0, 0)
      const endTime = addMinutes(startTime, 60)
      const assigneeUserId =
        overData.resourceId !== undefined && overData.resourceId !== UNASSIGNED_RESOURCE_ID
          ? overData.resourceId
          : null

      mutations.scheduleVisit.mutate({
        visitId: activeData.visitId,
        startTime,
        endTime,
        assigneeUserId,
      })
    },
    [mutations.scheduleVisit]
  )

  // The drag-overlay ghost — same chip content as the board's `renderEvent`, minus the popover.
  const renderDragGhost = useCallback(
    (event: DispatchVisitEvent) => <VisitChipContent event={event} />,
    []
  )

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <EmptyState
        icon={Lock}
        title='Dispatch Not Available'
        description='Upgrade your plan to use quoting and dispatch.'
        button={<div className='h-12' />}
      />
    )
  }

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <BoardToolbar
        date={data.date}
        onDateChange={data.setDate}
        view={data.view}
        onViewChange={data.setView}
        workers={data.allWorkers}
        selectedWorkerIds={data.selectedWorkerIds}
        onSelectedWorkerIdsChange={data.setSelectedWorkerIds}
        showBacklog={data.showBacklog}
        onShowBacklogChange={data.setShowBacklog}
      />
      <CalendarDndProvider<DispatchVisitEvent>
        onEventDrop={canEdit ? handleEventDrop : undefined}
        onDragEnd={canEdit ? handleForeignDragEnd : undefined}
        renderEvent={renderDragGhost}>
        <div className='flex flex-1 overflow-hidden'>
          {data.showBacklog && <BacklogRail items={data.backlogEvents} canEdit={canEdit} />}
          <BoardCalendarGrid
            date={data.date}
            onDateChange={data.setDate}
            view={data.view}
            weekStartsOn={weekStartsOn}
            resources={data.resources}
            backgroundEvents={backgroundEvents}
            events={data.events}
            overlappingIds={overlappingIds}
            canEdit={canEdit}
            mutations={mutations}
            existingVisits={existingVisits}
            activeVisitId={activeVisitId}
            onActiveVisitChange={setActiveVisitId}
            onRangeChange={data.handleRangeChange}
            onEventResize={handleEventResize}
          />
        </div>
      </CalendarDndProvider>
    </div>
  )
}
