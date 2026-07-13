// apps/web/src/components/dispatch/ui/board/dispatch-board.tsx

'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { CalendarDndProvider } from '@auxx/ui/components/event-calendar'
import { type DockedPanelConfig, MainPageContent } from '@auxx/ui/components/main-page'
import type { DragEndEvent } from '@dnd-kit/core'
import { addMinutes } from 'date-fns'
import { Lock } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useSettings } from '~/hooks/use-settings'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDockStore } from '~/stores/dock-store'
import { useRoutePlannerData } from '../route-planner/hooks/use-route-planner-data'
import { PlannerDndProvider } from '../route-planner/planner-dnd-provider'
import { RoutePlannerView } from '../route-planner/route-planner-view'
import { RoutesDrawer } from '../route-planner/routes-drawer'
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
 *
 * `boardMode === 'map'` (09-route-planner.md §A) swaps the calendar grid for `RoutePlannerView`.
 * The two drag contexts are mode-exclusive: `PlannerDndProvider` mounts ABOVE `MainPageContent`
 * (this component owns it, not the page — the docked Routes panel renders in `MainPageContent`'s
 * frame and must stay inside the planner's `DndContext`), while `CalendarDndProvider` wraps only
 * the calendar branch so its draggables bind to their own nearest context. The Routes stop lists
 * follow the standard dock wiring (`schedule-page.tsx` pattern): docked → `dockedPanels` entry,
 * not docked → overlay `RoutesDrawer`.
 */
export function DispatchBoard() {
  const { hasAccess } = useFeatureFlags()
  const { isAdminOrOwner } = useUser()
  const canEdit = isAdminOrOwner

  const data = useBoardData()
  const mutations = useBoardMutations(data.range)
  useBoardRealtime(data.range)

  // Route planner data (09-route-planner.md §A) lives here, not inside `RoutePlannerView`
  // itself — the toolbar's tag filter needs the same distinct-tags list and selection the map
  // uses, and the toolbar is `BoardToolbar`'s sibling, not `RoutePlannerView`'s child.
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

  const isMap = data.boardMode === 'map'
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Standard docked-panel wiring (`schedule-page.tsx` pattern): when docked, the Routes drawer
  // renders inside MainPageContent's panel frame; when not, it mounts below as the overlay.
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isMap || !isDocked || !data.plannerShowStops) return []
    return [
      {
        key: 'planner-routes',
        content: (
          <RoutesDrawer
            board={planner.board}
            filters={planner.filters}
            geometryByWorker={planner.geometryByWorker}
            date={planner.window}
            open
            onOpenChange={data.setPlannerShowStops}
          />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth: 320,
        maxWidth: 800,
      },
    ]
  }, [
    isMap,
    isDocked,
    data.plannerShowStops,
    data.setPlannerShowStops,
    planner.board,
    planner.filters,
    planner.geometryByWorker,
    planner.window,
    dockedWidth,
    setDockedWidth,
  ])

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
    <PlannerDndProvider
      board={planner.board}
      window={planner.window}
      geometryByWorker={planner.geometryByWorker}>
      <MainPageContent dockedPanels={dockedPanels}>
        <div className='flex h-full flex-col overflow-hidden'>
          <BoardToolbar
            date={data.date}
            onDateChange={data.setDate}
            view={data.view}
            onViewChange={data.setView}
            weekStartsOn={weekStartsOn}
            workers={data.allWorkers}
            selectedWorkerIds={data.selectedWorkerIds}
            onSelectedWorkerIdsChange={data.setSelectedWorkerIds}
            showBacklog={data.showBacklog}
            onShowBacklogChange={data.setShowBacklog}
            boardMode={data.boardMode}
            onBoardModeChange={data.setBoardMode}
            plannerShowBacklog={data.plannerShowBacklog}
            onPlannerShowBacklogChange={data.setPlannerShowBacklog}
            plannerShowStops={data.plannerShowStops}
            onPlannerShowStopsChange={data.setPlannerShowStops}
            tags={plannerTags}
            selectedTags={planner.filters.tags}
            onSelectedTagsChange={(tags) => planner.setFilters({ ...planner.filters, tags })}
          />
          {isMap ? (
            <RoutePlannerView
              board={planner.board}
              window={planner.window}
              geometryByWorker={planner.geometryByWorker}
              filters={planner.filters}
              isLoading={planner.isLoading}
              showBacklog={data.plannerShowBacklog}
            />
          ) : (
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
                  isNonWorkingDay={isNonWorkingDay}
                />
              </div>
            </CalendarDndProvider>
          )}
        </div>
        {isMap && !isDocked && (
          <RoutesDrawer
            board={planner.board}
            filters={planner.filters}
            geometryByWorker={planner.geometryByWorker}
            date={planner.window}
            open={data.plannerShowStops}
            onOpenChange={data.setPlannerShowStops}
          />
        )}
      </MainPageContent>
    </PlannerDndProvider>
  )
}
