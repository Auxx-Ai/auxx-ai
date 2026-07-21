// apps/web/src/components/dispatch/ui/sidebar/dispatch-sidebar.tsx

'use client'

import type { OptionColor } from '@auxx/lib/custom-fields/client'
import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { Switch } from '@auxx/ui/components/switch'
import { useMemo } from 'react'
import { DISPATCH_GETTING_STARTED_GOALS } from '~/components/dispatch/getting-started'
import { GettingStartedGroup } from '~/components/getting-started/ui/getting-started-group'
import {
  useDispatchSidebarStore,
  useHiddenWorkerIds,
  WORKERS_GROUP,
} from '../../stores/dispatch-sidebar-store'
import type { BacklogItem, BoardWorker } from '../board/types'
import type { WeekStartIndex } from '../board/utils'
import type {
  PlannerBoard,
  PlannerDayWindow,
  PlannerFilters,
  RouteGeometry,
} from '../route-planner/types'
import { BacklogGroup, type BacklogSection } from './backlog-group'
import { MiniCalendarSection } from './mini-calendar-section'
import { RoutesGroup } from './routes-group'
import { TagsGroup } from './tags-group'
import { WorkersGroup } from './workers-group'

interface DispatchSidebarProps {
  mode: 'calendar' | 'map'
  canEdit: boolean
  date: Date
  onDateChange: (date: Date) => void
  visibleRange: { from: Date; to: Date }
  /** Board view — week narrows the mini-calendar band to the visible week (calendar mode). */
  view?: 'day' | 'week' | 'month' | 'timeline'
  weekStartsOn: WeekStartIndex
  allWorkers: BoardWorker[]
  colorByUserId: Map<string, OptionColor>
  /** Calendar mode's flat backlog list (`use-board-data.ts`'s `backlogEvents`). */
  backlogEvents: BacklogItem[]
  /** Map mode's route planner read — all four are required together (map mode only). */
  plannerBoard?: PlannerBoard
  plannerFilters?: PlannerFilters
  plannerWindow?: PlannerDayWindow
  plannerGeometryByWorker?: Record<string, RouteGeometry | undefined>
  /** Distinct `work_order.tags` across the planner's visible day (map mode only). */
  tags?: string[]
  /** Backlog/routes row click (v4/02 Phase 3) — reports the clicked row's work-order instance
   * id AND visit id so the board shell can open a `RecordDrawer` pre-drilled to the visit.
   * Sidebar rows only; the map pin popover and board visit popover keep navigating to the job
   * page. */
  onSelectVisit?: (sel: { workOrderId: string; visitId: string }) => void
}

/**
 * The dispatch module sidebar (v3 sidebar plan §1.2) — mini month calendar, then stacked
 * collapsible groups: Workers (always), Tags (map mode), Backlog (always, two-bucket in map
 * mode), Routes (map mode). Must mount INSIDE each board mode's own DnD provider branch
 * (`dispatch-board.tsx`'s doc comment) — it is not itself DnD-context-aware.
 */
export function DispatchSidebar({
  mode,
  canEdit,
  date,
  onDateChange,
  visibleRange,
  view,
  weekStartsOn,
  allWorkers,
  colorByUserId,
  backlogEvents,
  plannerBoard,
  plannerFilters,
  plannerWindow,
  plannerGeometryByWorker,
  tags = [],
  onSelectVisit,
}: DispatchSidebarProps) {
  const open = useDispatchSidebarStore((s) => s.open)
  const setOpen = useDispatchSidebarStore((s) => s.setOpen)
  const groupOpen = useDispatchSidebarStore((s) => s.groupOpen)
  const setGroupOpen = useDispatchSidebarStore((s) => s.setGroupOpen)
  const hiddenWorkerIds = useHiddenWorkerIds()
  const toggleHidden = useDispatchSidebarStore((s) => s.toggleHidden)
  const toggleWorkerHidden = (workerId: string) => toggleHidden(WORKERS_GROUP, workerId)
  const selectedTags = useDispatchSidebarStore((s) => s.selectedTags)
  const setSelectedTags = useDispatchSidebarStore((s) => s.setSelectedTags)
  const showCanceled = useDispatchSidebarStore((s) => s.showCanceled)
  const setShowCanceled = useDispatchSidebarStore((s) => s.setShowCanceled)

  const isGroupOpen = (key: string) => groupOpen[key] ?? true

  const toggleTag = (tag: string) => {
    const current = selectedTags ?? tags
    const set = new Set(current)
    if (set.has(tag)) set.delete(tag)
    else set.add(tag)
    setSelectedTags(set.size === tags.length ? null : Array.from(set))
  }

  // Map mode's two-bucket split — ported from the deleted `backlog-pane.tsx`'s
  // `unscheduled`/`unassignedToday` derivations (tag-filtered the same way).
  const backlogSections: BacklogSection[] = useMemo(() => {
    if (mode === 'calendar') return [{ items: backlogEvents }]
    if (!plannerBoard) return []
    const workOrderById = new Map(plannerBoard.workOrders.map((w) => [w.id, w]))
    const tagSet = selectedTags === null ? null : new Set(selectedTags)
    const matchesTagFilter = (workOrderId: string) => {
      if (tagSet === null) return true
      const wo = workOrderById.get(workOrderId)
      return wo ? wo.tags.some((t) => tagSet.has(t)) : false
    }
    const unscheduled = plannerBoard.backlog.filter((v) => matchesTagFilter(v.workOrderId))
    const unassignedToday = plannerBoard.visits.filter(
      (v) => v.assigneeUserId === null && v.status !== 'canceled' && matchesTagFilter(v.workOrderId)
    )
    return [
      {
        title: 'Unscheduled',
        items: unscheduled.map((v) => ({ visit: v, workOrder: workOrderById.get(v.workOrderId) })),
      },
      {
        title: 'Unassigned today',
        items: unassignedToday.map((v) => ({
          visit: v,
          workOrder: workOrderById.get(v.workOrderId),
        })),
      },
    ]
  }, [mode, backlogEvents, plannerBoard, selectedTags])

  return (
    <ModuleSidebar
      open={open}
      onOpenChange={setOpen}
      className='py-0 [&_[data-sidebar=content]]:pt-0!'
      footer={
        /* Plan 30 §B.1 — "Show canceled" pinned footer toggle. Default off (canceled/skipped
         * visits hidden from the board + mini-calendar day markers). Rooted in a `<div>` (not
         * `SidebarItem`'s own button/link root) so the trailing `Switch` — itself a real
         * `<button role="switch">` — never nests inside another interactive element. */
        <SidebarFooter className='p-2'>
          <GettingStartedGroup
            checklistId='dispatch'
            catalog={DISPATCH_GETTING_STARTED_GOALS}
            title='Dispatch setup'
          />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size='sm' className='h-7'>
                <div className='flex w-full items-center justify-between'>
                  <span className='truncate'>Show canceled</span>
                  <Switch size='xs' checked={showCanceled} onCheckedChange={setShowCanceled} />
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      }>
      <MiniCalendarSection
        date={date}
        onDateChange={onDateChange}
        visibleRange={visibleRange}
        weekStartsOn={weekStartsOn}
        hiddenWorkerIds={hiddenWorkerIds}
        view={view}
        includeCanceled={showCanceled}
      />
      <WorkersGroup
        workers={allWorkers}
        colorByUserId={colorByUserId}
        hiddenWorkerIds={hiddenWorkerIds}
        onToggleWorker={toggleWorkerHidden}
        open={isGroupOpen('workers')}
        onOpenChange={(o) => setGroupOpen('workers', o)}
        mode={mode}
      />
      {mode === 'map' && (
        <TagsGroup
          tags={tags}
          selectedTags={selectedTags}
          onToggleTag={toggleTag}
          open={isGroupOpen('tags')}
          onOpenChange={(o) => setGroupOpen('tags', o)}
        />
      )}
      <BacklogGroup
        sections={backlogSections}
        dragType={mode === 'calendar' ? 'backlog-visit' : 'planner-backlog'}
        canEdit={canEdit}
        droppable={mode === 'calendar'}
        open={isGroupOpen('backlog')}
        onOpenChange={(o) => setGroupOpen('backlog', o)}
        onSelectVisit={onSelectVisit}
      />
      {mode === 'map' && plannerBoard && plannerFilters && plannerWindow && (
        <RoutesGroup
          board={plannerBoard}
          filters={plannerFilters}
          geometryByWorker={plannerGeometryByWorker ?? {}}
          date={plannerWindow}
          canEdit={canEdit}
          open={isGroupOpen('routes')}
          onOpenChange={(o) => setGroupOpen('routes', o)}
          groupOpen={groupOpen}
          onWorkerOpenChange={(userId, o) => setGroupOpen(`routes:${userId}`, o)}
          onSelectVisit={onSelectVisit}
        />
      )}
    </ModuleSidebar>
  )
}
