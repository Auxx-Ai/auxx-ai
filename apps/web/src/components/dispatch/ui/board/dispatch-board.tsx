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
import { PasteVisitsDialog } from '~/components/calendar/ui/paste-visits-dialog'
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
import { BoardBulkBar } from './board-bulk-bar'
import { BoardCalendarGrid } from './board-calendar-grid'
import { BoardToolbar } from './board-toolbar'
import { EventDockPanel } from './event-dock-panel'
import { computeGroupDragUpdates } from './group-drag'
import { useAvailabilityShading } from './hooks/use-availability-shading'
import { useBoardBulkActions } from './hooks/use-board-bulk-actions'
import { useBoardBulkRunner } from './hooks/use-board-bulk-runner'
import { useBoardClipboard } from './hooks/use-board-clipboard'
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
 * color-coded; month drags are whole-day moves (time-of-day preserved, no resize — 37c §6
 * revised M2a's display-only month). All writes funnel through `dispatch.scheduleVisit`
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
  // Group drag-move (plan 37c §6) — looked up by id so `handleEventDrop` can find every OTHER
  // selected visit's own start/end without re-deriving it from the drop event.
  const eventsById = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events])

  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  // Multi-selection (plan 37c §3) — independent of `activeVisitId` ("which popover is open"):
  // a plain click sets both (the grid fires `onSelectionChange` AND `onEventClick`), a
  // cmd/shift-click only ever touches this.
  const [selectedVisitIds, setSelectedVisitIds] = useState<string[]>([])
  const clearSelection = useCallback(() => setSelectedVisitIds([]), [])

  // Board-local bulk runner (plan 37c §5.2) — one instance shared by the bulk bar (which
  // drives `run()`) and the grid (which dims `pendingVisitIds` chips), so both read the same
  // in-flight set.
  const bulkRunner = useBoardBulkRunner()
  // Id-parameterized bulk actions (plan 44 §6) — one instance shared by the bulk bar (targets the
  // selection) and the grid's chip context menu (targets its resolved right-click ids).
  const bulkActions = useBoardBulkActions({
    mutations,
    bulkRunner,
    onClearSelection: clearSelection,
  })

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

  // Clipboard + paste (plan 37c §4/§5, Phase 3, board only) — Cmd+C/Cmd+V keybindings, the
  // hovered-slot ref `BoardCalendarGrid` feeds into `EventCalendar`, and the paste-options
  // dialog's open/target state. `workOrderResource?.id` (the `work-orders` def id) is what
  // turns a copied `DispatchVisitEvent.workOrderId` (an `EntityInstance` id) into the
  // `RecordId` `dispatch.pasteVisits` wants — copy stays inert until resources have loaded.
  // Gated off in map mode too (`!isMap`) — the calendar grid (and its selection) isn't even
  // mounted there, so a stray Cmd+C/Cmd+V shouldn't silently act on a stale selection or pop
  // the paste dialog open after switching back to the calendar.
  const clipboard = useBoardClipboard({
    events: data.events,
    selectedVisitIds,
    boardDate: data.date,
    workOrderDefId: workOrderResource?.id,
    canEdit: canEdit && data.boardMode !== 'map',
  })
  const pasteItems = useMemo(() => clipboard.clipboardItems ?? [], [clipboard.clipboardItems])

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
    (
      event: DispatchVisitEvent,
      newStart: Date,
      newEnd: Date,
      resourceId?: string,
      groupIds?: string[]
    ) => {
      // Month drops commit too (37c §6 revised M2a's display-only month): the dnd layer builds
      // `newStart` from the target day with the visit's original time-of-day and duration
      // preserved, and month cells carry no `resourceId`, so the assignee stays untouched.
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

      // Group drag-move (plan 37c §6) — `groupIds` (from the generic layer's selection-aware
      // drag data) is only ever length > 1 when the dragged chip was part of a multi-selection.
      // Every OTHER selected visit shifts by the same delta; assignee is carried to them ONLY
      // when the drop actually changed the dragged chip's own worker column (`resourceId`
      // differs from its OWN original `resourceId` — every resource/day/timeline column always
      // reports SOME `resourceId`, even the one the chip started in, so this is the only correct
      // "did the row change" test). Committed through the same §5.2 sequential-loop runner the
      // bulk bar uses — no confirm (the drag itself is the intent), no new endpoint.
      if (groupIds && groupIds.length > 1) {
        const rowChanged = resourceId !== undefined && resourceId !== event.resourceId
        const updates = computeGroupDragUpdates(
          event.id,
          new Date(event.start),
          newStart,
          groupIds,
          eventsById,
          rowChanged ? assigneeUserId : undefined
        )
        if (updates.length > 0) {
          const updatesByVisitId = new Map(updates.map((u) => [u.visitId, u]))
          void bulkRunner.run(
            Array.from(updatesByVisitId.keys()),
            (visitId) => {
              const update = updatesByVisitId.get(visitId)!
              return mutations.scheduleVisit.mutateAsync({
                visitId,
                startTime: update.startTime,
                endTime: update.endTime,
                assigneeUserId: update.assigneeUserId,
              })
            },
            {
              failureTitle: 'Some visits could not be moved',
              failureNoun: 'visits',
            }
          )
        }
      }
    },
    [mutations.scheduleVisit, eventsById, bulkRunner]
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
                selectedEventIds={selectedVisitIds}
                onSelectionChange={setSelectedVisitIds}
                pendingVisitIds={bulkRunner.pendingVisitIds}
                onRangeChange={data.handleRangeChange}
                onEventResize={handleEventResize}
                onOpenRecord={handleOpenRecord}
                isNonWorkingDay={isNonWorkingDay}
                isDockOpen={isEventDockOpen}
                hoveredSlotRef={clipboard.hoveredSlotRef}
                hasClipboard={clipboard.hasClipboard}
                onCopyIds={clipboard.copyIds}
                onPasteAt={clipboard.openPasteDialogAt}
                bulkActions={bulkActions}
              />
            </div>
          </CalendarDndProvider>
        )}
      </div>
      {!isMap && canEdit && (
        <PasteVisitsDialog
          target={clipboard.pasteTarget}
          onOpenChange={(open) => {
            if (!open) clipboard.closePasteDialog()
          }}
          items={pasteItems}
          workers={data.workers}
          pasteVisits={mutations.pasteVisits}
        />
      )}
      {!isMap && canEdit && (
        <BoardBulkBar
          selectedVisitIds={selectedVisitIds}
          onCopySelection={clipboard.copySelection}
          bulkRunner={bulkRunner}
          bulkActions={bulkActions}
          onClearSelection={clearSelection}
        />
      )}
      {overlays}
    </MainPageContent>
  )
}
