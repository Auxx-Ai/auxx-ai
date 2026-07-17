// apps/web/src/components/dispatch/ui/board/dispatch-board.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { isRecordId } from '@auxx/lib/resources/client'
import { CalendarDndProvider } from '@auxx/ui/components/event-calendar'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { toastError } from '@auxx/ui/components/toast'
import type { DragEndEvent } from '@dnd-kit/core'
import { addMinutes } from 'date-fns'
import { Lock } from 'lucide-react'
import { parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { renderAppDragGhost } from '~/components/global/app-drag-overlay'
import { EmptyState } from '~/components/global/empty-state'
import { RecordDrawer } from '~/components/records/record-drawer'
import { toRecordId, useResource } from '~/components/resources'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useUser } from '~/hooks/use-user'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import { useRoutePlannerData } from '../route-planner/hooks/use-route-planner-data'
import { PlannerDndProvider } from '../route-planner/planner-dnd-provider'
import { RoutePlannerView } from '../route-planner/route-planner-view'
import type { ExistingVisitForOverlap } from '../schedule-popover'
import { DispatchSidebar } from '../sidebar/dispatch-sidebar'
import { BoardCalendarGrid } from './board-calendar-grid'
import { BoardToolbar } from './board-toolbar'
import { EventDockPanel } from './event-dock-panel'
import { useAvailabilityShading } from './hooks/use-availability-shading'
import { useBoardData } from './hooks/use-board-data'
import { useBoardMutations } from './hooks/use-board-mutations'
import { useBoardRealtime } from './hooks/use-board-realtime'
import type { DispatchVisitEvent } from './types'
import { UNASSIGNED_RESOURCE_ID } from './types'
import { computeOverlappingVisitIds } from './utils'
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
  // Optimistic cache surgery targets the `getBoard` query key, which is now the deterministic
  // `fetchWindow` (not the visible `range`) — pass the same value so patches/rollbacks land.
  const mutations = useBoardMutations(data.fetchWindow)
  useBoardRealtime()

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

  // Org week-start (Mon/Sun/Sat) → `date-fns` index, derived once in `useBoardData` (it needs the
  // same value for the month-anchor reducer) and reused here for the toolbar/grid/sidebar.
  const weekStartsOn = data.weekStartsOn

  const workerUserIds = useMemo(() => data.workers.map((w) => w.userId), [data.workers])
  const { backgroundEvents, isNonWorkingDay } = useAvailabilityShading({
    view: data.view,
    range: data.range,
    fetchWindow: data.fetchWindow,
    workerUserIds,
  })

  const overlappingIds = useMemo(() => computeOverlappingVisitIds(data.events), [data.events])

  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)

  // Dockable event panel (plan 21) — a board-scoped push column, separate from the page-level
  // `useDockedPanels` dock further below that drives the record drawer; this
  // one only ever knows about the calendar's selected event. `isEventDockOpen` alone (not the
  // side) is all `BoardCalendarGrid` needs to suppress the floating popover.
  const isEventDockOpen = useDispatchSidebarStore((s) => s.eventDock.open)
  const selectedEvent = useMemo(
    () => data.events.find((e) => e.id === activeVisitId) ?? null,
    [data.events, activeVisitId]
  )

  // Record-peek drawer (v4 Phase 4, decision #8; deep-drill wiring per v4/02 Phase 3):
  // `?record=<defId>:<instanceId>&panel=visits&item=<visitId>` — a full RecordId in the URL
  // (nuqs-synced, records-view's `?id=` precedent) so the drawer is deep-linkable and
  // def-qualified: ANY record type (work order, invoice, quote, …) can be peeked from the
  // board by setting `record`. Sidebar backlog/route rows report both the work-order instance
  // id and the visit id; resolve the entityDefinitionId once here (same recipe as
  // `board/visit-popover.tsx`) so the sidebar itself stays def-id-agnostic, and write all
  // three params in one `useQueryStates` call so opening/closing the drawer is a single
  // history entry that lands the `BaseEntityDrawer` pre-drilled onto that visit (`panel:
  // 'visits'`, `item: visitId`) instead of the generic work-order overview. The map pin
  // popover and board visit popover keep navigating to the job page.
  const { resource: workOrderResource } = useResource('work-orders')
  const [{ record: recordParam }, setDrawerParams] = useQueryStates({
    record: parseAsString,
    panel: parseAsString,
    item: parseAsString,
  })
  const drawerRecordId = recordParam && isRecordId(recordParam) ? recordParam : null
  const handleSelectVisit = useCallback(
    (sel: { workOrderId: string; visitId: string }) => {
      if (!workOrderResource) return
      setDrawerParams({
        record: toRecordId(workOrderResource.id, sel.workOrderId),
        panel: 'visits',
        item: sel.visitId,
      })
    },
    [workOrderResource, setDrawerParams]
  )
  const handleDrawerOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setDrawerParams({ record: null, panel: null, item: null })
    },
    [setDrawerParams]
  )
  // Generic drawer-open used by the chip popover: any record (work order → pre-drilled to the
  // clicked visit, or its contact) opens in the same `?record=` drawer as the sidebar rows.
  const handleOpenRecord = useCallback(
    (recordId: string, drill?: { panel?: string; item?: string }) => {
      setDrawerParams({ record: recordId, panel: drill?.panel ?? null, item: drill?.item ?? null })
    },
    [setDrawerParams]
  )

  // Dock-aware drawer placement: user's dock preference on → the drawer renders
  // as a resizable `MainPageContent` docked panel; off (or mobile) → overlay.
  const { dockedPanels, overlays } = useDockedPanels(
    drawerRecordId
      ? [
          {
            key: 'record-detail',
            open: true,
            content: (
              <RecordDrawer open onOpenChange={handleDrawerOpenChange} recordId={drawerRecordId} />
            ),
          },
        ]
      : []
  )

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
    (event: DispatchVisitEvent, newStart: Date, newEnd: Date) => {
      mutations.scheduleVisit.mutate({
        visitId: event.id,
        startTime: newStart,
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
        // Plan 30 §D.1 — series visits never go back to the backlog (server rejects it too);
        // this gesture only makes sense for a rule-less visit. Silently no-op with a toast
        // rather than firing a mutation the server will bounce.
        if (activeData.event.recurrenceRuleId) {
          toastError({
            title: "Can't move to backlog",
            description: "Recurring visits can't move to the backlog — reschedule or skip instead.",
          })
          return
        }
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
    <MainPageContent dockedPanels={dockedPanels}>
      <div className='flex h-full flex-col overflow-hidden'>
        <BoardToolbar
          date={data.date}
          onDateChange={data.setDate}
          onDateSelect={data.setDateAbsolute}
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
                onDateChange={data.setDateAbsolute}
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
                onSelectVisit={handleSelectVisit}
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
            renderEvent={renderDragGhost}
            renderForeignOverlay={renderAppDragGhost}>
            <div className='flex flex-1 overflow-hidden'>
              <DispatchSidebar
                mode='calendar'
                canEdit={canEdit}
                date={data.date}
                onDateChange={data.setDateAbsolute}
                visibleRange={data.range}
                view={data.view}
                weekStartsOn={weekStartsOn}
                allWorkers={data.allWorkers}
                colorByUserId={data.colorByUserId}
                backlogEvents={data.backlogEvents}
                onSelectVisit={handleSelectVisit}
              />
              {/* Sits between sidebar and grid in DOM so a left dock reads as a second left
               * column next to the grid (plan 21); `DockPanel` orders itself after the grid
               * when `side='right'`. */}
              <EventDockPanel
                event={selectedEvent}
                onActiveVisitChange={setActiveVisitId}
                canEdit={canEdit}
                mutations={mutations}
                existingVisits={existingVisits}
                onOpenRecord={handleOpenRecord}
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
                onOpenRecord={handleOpenRecord}
                isNonWorkingDay={isNonWorkingDay}
                isDockOpen={isEventDockOpen}
              />
            </div>
          </CalendarDndProvider>
        )}
      </div>
      {overlays}
    </MainPageContent>
  )
}
