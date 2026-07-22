// apps/web/src/components/dispatch/ui/sidebar/workers-group.tsx

'use client'

import type { OptionColor } from '@auxx/lib/custom-fields/client'
import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { useDndContext, useDroppable } from '@dnd-kit/core'
import { UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SourceToggleRow } from '~/components/calendar/ui/source-toggle-group'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { type BoardWorker, UNASSIGNED_RESOURCE_ID } from '../board/types'
import { DEFAULT_WORKER_COLOR, UNASSIGNED_COLOR, workerDisplayName } from '../board/utils'
import { WorkerDialog } from '../worker-dialog'

interface WorkersGroupProps {
  workers: BoardWorker[]
  /** Per-worker `OPTION_COLORS` entry, keyed by `DispatchWorker.id` (`use-board-data.ts`'s
   * `colorByWorkerId` — the stored `SelectOptionColor` id resolved to its palette entry; this
   * row's dot reads `.hex`, since several palette ids can't render directly as a CSS color). */
  colorByWorkerId: Map<string, OptionColor>
  hiddenWorkerIds: string[]
  onToggleWorker: (workerId: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 'map' mode enables droppable worker rows for backlog/stop assignments; 'calendar' disables
   * (calendar mode routes drops via handleForeignDragEnd which doesn't target worker rows). */
  mode?: 'map' | 'calendar'
}

/**
 * Wrapper component to make a SourceToggleRow representing a worker droppable for backlog
 * items and route stops. `id` is the row's board identity — a `DispatchWorker.id` (individual or
 * team) or the synthetic Unassigned sentinel — and doubles as the route planner's own drop-target
 * assignee (`PlannerWorkerListDropData.assigneeWorkerId`, plans/dispatch/45-teams.md §5A): `null`
 * only for the Unassigned row, passed explicitly by the caller.
 */
function DroppableWorkerRow({
  id,
  dropAssigneeWorkerId,
  label,
  color,
  visible,
  onToggle,
  mode,
}: {
  id: string
  dropAssigneeWorkerId: string | null
  label: string
  color: string
  visible: boolean
  onToggle: () => void
  mode?: 'map' | 'calendar'
}) {
  const { active } = useDndContext()
  const isCompatibleDrag =
    active?.data.current?.type === 'planner-backlog' ||
    active?.data.current?.type === 'planner-stop'
  const { setNodeRef, isOver } = useDroppable({
    id: `worker-row-${id}`,
    data: {
      type: 'planner-worker-list',
      assigneeWorkerId: dropAssigneeWorkerId,
    },
    disabled: mode !== 'map' || !isCompatibleDrag,
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md transition-colors duration-150 ease-in-out',
        // Inset variants (entity-folder.tsx's recipe) — the sidebar clips overflow, so a
        // non-inset ring/outline gets cut off at the group edges.
        isCompatibleDrag && 'outline-dashed outline-1 outline-primary/30 [outline-offset:-1px]',
        isCompatibleDrag &&
          isOver &&
          'bg-primary/20 outline-primary/80 ring-2 ring-inset ring-primary/60'
      )}>
      <SourceToggleRow id={id} label={label} color={color} visible={visible} onToggle={onToggle} />
    </div>
  )
}

/**
 * Sidebar Workers group (v3 sidebar plan §1.2, refactored onto the global `SidebarGroupHeader`/
 * `SidebarItem` primitives per plans/dispatch/v3/02-sidebar-primitives-refactor.md Phase 3) — a
 * color-dot + visibility-toggle row per worker plus a synthetic "Unassigned" row
 * (`UNASSIGNED_RESOURCE_ID`), mirroring the deleted `WorkerFilterPopover`'s exact selection
 * semantics: toggling writes the store's `hiddenWorkerIds` (inverse set — see `board/utils.ts`'s
 * `selectedWorkerIdsFromHidden` adapter for how consumers read it back as `Set<string> | null`).
 * The header's `additionalOptions` opens `WorkerDialog` in create mode ("New worker").
 *
 * In map mode, worker rows become droppable targets for backlog items and route stops; in
 * calendar mode, drops are handled by handleForeignDragEnd which doesn't target worker rows.
 */
export function WorkersGroup({
  workers,
  colorByWorkerId,
  hiddenWorkerIds,
  onToggleWorker,
  open,
  onOpenChange,
  mode = 'map',
}: WorkersGroupProps) {
  const hidden = useMemo(() => new Set(hiddenWorkerIds), [hiddenWorkerIds])
  const [addOpen, setAddOpen] = useState(false)

  const additionalOptions = (
    <DropdownMenuItem
      onClick={(e) => {
        e.stopPropagation()
        setAddOpen(true)
      }}>
      <UserPlus />
      New worker
    </DropdownMenuItem>
  )

  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title='Workers'
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
        additionalOptions={additionalOptions}
      />
      <SidebarGroupCollapse open={open}>
        <SidebarMenu>
          {workers.map((worker) => (
            <DroppableWorkerRow
              key={worker.id}
              id={worker.id}
              dropAssigneeWorkerId={worker.id}
              label={workerDisplayName(worker)}
              color={colorByWorkerId.get(worker.id)?.hex ?? DEFAULT_WORKER_COLOR}
              visible={!hidden.has(worker.id)}
              onToggle={() => onToggleWorker(worker.id)}
              mode={mode}
            />
          ))}
          <DroppableWorkerRow
            id={UNASSIGNED_RESOURCE_ID}
            dropAssigneeWorkerId={null}
            label='Unassigned'
            color={UNASSIGNED_COLOR}
            visible={!hidden.has(UNASSIGNED_RESOURCE_ID)}
            onToggle={() => onToggleWorker(UNASSIGNED_RESOURCE_ID)}
            mode={mode}
          />
        </SidebarMenu>
      </SidebarGroupCollapse>
      <WorkerDialog open={addOpen} onOpenChange={setAddOpen} workerId={null} />
    </SidebarGroup>
  )
}
