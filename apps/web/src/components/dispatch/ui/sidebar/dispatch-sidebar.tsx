// apps/web/src/components/dispatch/ui/sidebar/dispatch-sidebar.tsx

'use client'

import { ModuleSidebar } from '@auxx/ui/components/module-sidebar'
import { useMemo } from 'react'
import { useDispatchSidebarStore } from '~/stores/dispatch-sidebar-store'
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
  weekStartsOn: WeekStartIndex
  allWorkers: BoardWorker[]
  colorByUserId: Map<string, string>
  /** Calendar mode's flat backlog list (`use-board-data.ts`'s `backlogEvents`). */
  backlogEvents: BacklogItem[]
  /** Map mode's route planner read — all four are required together (map mode only). */
  plannerBoard?: PlannerBoard
  plannerFilters?: PlannerFilters
  plannerWindow?: PlannerDayWindow
  plannerGeometryByWorker?: Record<string, RouteGeometry | undefined>
  /** Distinct `work_order.tags` across the planner's visible day (map mode only). */
  tags?: string[]
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
  weekStartsOn,
  allWorkers,
  colorByUserId,
  backlogEvents,
  plannerBoard,
  plannerFilters,
  plannerWindow,
  plannerGeometryByWorker,
  tags = [],
}: DispatchSidebarProps) {
  const open = useDispatchSidebarStore((s) => s.open)
  const setOpen = useDispatchSidebarStore((s) => s.setOpen)
  const groupOpen = useDispatchSidebarStore((s) => s.groupOpen)
  const setGroupOpen = useDispatchSidebarStore((s) => s.setGroupOpen)
  const hiddenWorkerIds = useDispatchSidebarStore((s) => s.hiddenWorkerIds)
  const toggleWorkerHidden = useDispatchSidebarStore((s) => s.toggleWorkerHidden)
  const selectedTags = useDispatchSidebarStore((s) => s.selectedTags)
  const setSelectedTags = useDispatchSidebarStore((s) => s.setSelectedTags)

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
    <ModuleSidebar open={open} onOpenChange={setOpen}>
      <MiniCalendarSection
        date={date}
        onDateChange={onDateChange}
        visibleRange={visibleRange}
        weekStartsOn={weekStartsOn}
        hiddenWorkerIds={hiddenWorkerIds}
      />
      <WorkersGroup
        workers={allWorkers}
        colorByUserId={colorByUserId}
        hiddenWorkerIds={hiddenWorkerIds}
        onToggleWorker={toggleWorkerHidden}
        open={isGroupOpen('workers')}
        onOpenChange={(o) => setGroupOpen('workers', o)}
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
      />
      {mode === 'map' && plannerBoard && plannerFilters && plannerWindow && (
        <RoutesGroup
          board={plannerBoard}
          filters={plannerFilters}
          geometryByWorker={plannerGeometryByWorker ?? {}}
          date={plannerWindow}
          open={isGroupOpen('routes')}
          onOpenChange={(o) => setGroupOpen('routes', o)}
          groupOpen={groupOpen}
          onWorkerOpenChange={(userId, o) => setGroupOpen(`routes:${userId}`, o)}
        />
      )}
    </ModuleSidebar>
  )
}
