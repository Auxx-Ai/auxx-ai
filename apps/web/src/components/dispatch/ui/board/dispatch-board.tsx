// apps/web/src/components/dispatch/ui/board/dispatch-board.tsx

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { CalendarDndProvider } from '@auxx/ui/components/event-calendar'
import { MainPageContent } from '@auxx/ui/components/main-page'
import type { DragEndEvent } from '@dnd-kit/core'
import { addMinutes } from 'date-fns'
import { Lock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDispatchSidebarStore } from '~/stores/dispatch-sidebar-store'
import { useRoutePlannerData } from '../route-planner/hooks/use-route-planner-data'
import { PlannerDndProvider } from '../route-planner/planner-dnd-provider'
import { RoutePlannerView } from '../route-planner/route-planner-view'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { DispatchSidebar } from '../sidebar/dispatch-sidebar'
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
 * (drag/resize/backlog-drop) or the chip popover's status/dispatch mutations.
 *
 * `boardMode === 'map'` (09-route-planner.md §A) swaps the calendar grid for `RoutePlannerView`.
 * The two drag contexts are mode-exclusive: `PlannerDndProvider` wraps the map branch's row
 * (`DispatchSidebar` + `RoutePlannerView`), `CalendarDndProvider` wraps the calendar branch's row
 * (`DispatchSidebar` + `BoardCalendarGrid`) — so `DispatchSidebar` mounts INSIDE each mode's own
 * provider (v3 sidebar plan §1.3), not once above both, and its draggables/droppables (Backlog
 * rows, Routes stop lists) bind to the right nearest `DndContext` per mode.
 */
export function DispatchBoard() {
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  const canEdit = isAdminOrOwner

  const data = useBoardData()
  const mutations = useBoardMutations(data.range)
  useBoardRealtime(data.range)

  // Route planner data (09-route-planner.md §A) lives here, not inside `RoutePlannerView`
  // itself — the sidebar's Tags group needs the same distinct-tags list and selection the map
  // uses, and the sidebar is `RoutePlannerView`'s sibling, not its child.
  const planner = useRoutePlannerData({
    date: data.date,
    selectedWorkerIds: data.selectedWorkerIds,
    enabled: data.boardMode === 'map',
  })
  const plannerTags = useMemo(() => {
    const set = new Set<string>()
    for (const wo of planner.board.workOrders) for (const tag of wo.tags) set.add(tag)
    return Array.from(set).sort()
  }, [planner.board.workOrders])

  // The sidebar's Tags group persists `selectedTags` in the dispatch-sidebar store; sync it
  // into the planner's own `PlannerFilters.tags` (the shape `PlannerMap`/backlog sections read)
  // — `setFilters` only ever assigns the `tags` half (`use-route-planner-data.ts`), so the
  // `workerIds` value passed here is discarded, not a second source of truth.
  const selectedTags = useDispatchSidebarStore((s) => s.selectedTags)
  const selectedTagsSet = useMemo(
    () => (selectedTags === null ? null : new Set(selectedTags)),
    [selectedTags]
  )
  useEffect(() => {
    planner.setFilters({ workerIds: data.selectedWorkerIds, tags: selectedTagsSet })
  }, [selectedTagsSet, data.selectedWorkerIds, planner.setFilters])

  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)

  const workerUserIds = useMemo(() => data.workers.map((w) => w.userId), [data.workers])
  const { backgroundEvents, isNonWorkingDay } = useAvailabilityShading({
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

  // `CalendarDndProvider`'s `onDragEnd` escape hatch hands us every drag end regardless of
  // whether the dragged item is a calendar event (07 §D.2) — used for two non-cell drops:
  // a sidebar Backlog row dropped on the calendar grid (schedules it), and a calendar event
  // dropped on the sidebar's Backlog group (v3 sidebar plan §2.4 — unschedules it).
  const handleForeignDragEnd = useCallback(
    (dragEvent: DragEndEvent) => {
      const activeData = dragEvent.active.data.current as
        | { type?: string; visitId?: string; event?: DispatchVisitEvent }
        | undefined
      const overData = dragEvent.over?.data.current as
        | { type?: string; date?: Date; time?: number; resourceId?: string }
        | undefined

      if (activeData?.event && overData?.type === 'sidebar-backlog') {
        mutations.unscheduleVisit.mutate({ visitId: activeData.event.id })
        return
      }

      if (activeData?.type !== 'backlog-visit' || !activeData.visitId) return
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
    [mutations.scheduleVisit, mutations.unscheduleVisit]
  )

  // The drag-overlay ghost — same chip content as the board's `renderEvent`, minus the popover.
  const renderDragGhost = useCallback(
    (event: DispatchVisitEvent) => <VisitChipContent event={event} />,
    []
  )

  const isMap = data.boardMode === 'map'

  if (!hasAccess(FeatureKey.dispatch)) {
    return (
      <MainPageContent>
        <EmptyState
          icon={Lock}
          title='Dispatch Not Available'
          description='Upgrade your plan to use quoting and dispatch.'
          button={<div className='h-12' />}
        />
      </MainPageContent>
    )
  }

  return (
    <MainPageContent>
      <div className='flex h-full flex-col overflow-hidden'>
        <BoardToolbar
          date={data.date}
          onDateChange={data.setDate}
          view={data.view}
          onViewChange={data.setView}
          weekStartsOn={weekStartsOn}
          boardMode={data.boardMode}
          onBoardModeChange={data.setBoardMode}
        />
        {isMap ? (
          <PlannerDndProvider
            board={planner.board}
            window={planner.window}
            geometryByWorker={planner.geometryByWorker}>
            <div className='flex flex-1 overflow-hidden'>
              <DispatchSidebar
                mode='map'
                canEdit={canEdit}
                date={data.date}
                onDateChange={data.setDate}
                visibleRange={data.range}
                weekStartsOn={weekStartsOn}
                allWorkers={data.allWorkers}
                colorByUserId={data.colorByUserId}
                backlogEvents={data.backlogEvents}
                plannerBoard={planner.board}
                plannerFilters={planner.filters}
                plannerWindow={planner.window}
                plannerGeometryByWorker={planner.geometryByWorker}
                tags={plannerTags}
              />
              <RoutePlannerView
                board={planner.board}
                window={planner.window}
                geometryByWorker={planner.geometryByWorker}
                filters={planner.filters}
                isLoading={planner.isLoading}
              />
            </div>
          </PlannerDndProvider>
        ) : (
          <CalendarDndProvider<DispatchVisitEvent>
            onEventDrop={canEdit ? handleEventDrop : undefined}
            onDragEnd={canEdit ? handleForeignDragEnd : undefined}
            renderEvent={renderDragGhost}>
            <div className='flex flex-1 overflow-hidden'>
              <DispatchSidebar
                mode='calendar'
                canEdit={canEdit}
                date={data.date}
                onDateChange={data.setDate}
                visibleRange={data.range}
                weekStartsOn={weekStartsOn}
                allWorkers={data.allWorkers}
                colorByUserId={data.colorByUserId}
                backlogEvents={data.backlogEvents}
              />
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
                isNonWorkingDay={isNonWorkingDay}
              />
            </div>
          </CalendarDndProvider>
        )}
      </div>
    </MainPageContent>
  )
}
