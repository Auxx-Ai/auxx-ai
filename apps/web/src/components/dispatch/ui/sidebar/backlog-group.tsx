// apps/web/src/components/dispatch/ui/sidebar/backlog-group.tsx

'use client'

import {
  SidebarGroup,
  SidebarGroupCollapse,
  SidebarMenu,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import type { BacklogItem } from '../board/types'
import { isVisitStatus } from '../board/utils'
import { STATUS_ACCENT_CLASS } from '../board/visit-chip-content'

export interface BacklogSection {
  /** Sub-header, e.g. map mode's "Unscheduled"/"Unassigned today" split. Omit for a flat list
   * (calendar mode). */
  title?: string
  items: BacklogItem[]
}

interface BacklogGroupProps {
  sections: BacklogSection[]
  /** Draggable payload type — `'backlog-visit'` in calendar mode (read by
   * `dispatch-board.tsx`'s `CalendarDndProvider` escape hatch), `'planner-backlog'` in map mode
   * (read by `useRoutePlannerDragEnd`). */
  dragType: 'backlog-visit' | 'planner-backlog'
  canEdit: boolean
  /** Calendar mode only (v3 Phase 2.4): makes the group body a `useDroppable` target so a
   * dragged calendar event can be dropped here to unschedule it. */
  droppable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Sidebar Backlog group (v3 sidebar plan §1.2, refactored onto the global `SidebarGroupHeader`/
 * `SidebarItem` primitives per plans/dispatch/v3/02-sidebar-primitives-refactor.md Phase 3) —
 * one-line rows (status dot + WO number + truncated title, grip on hover), ported from the
 * deleted `backlog-rail.tsx`/`backlog-pane.tsx`. Serves both modes: calendar mode gets a flat
 * list (`data.backlogEvents`), map mode gets the two-bucket split `BacklogPane` used to compute
 * (`DispatchSidebar` builds `sections`, this component only renders them). The group count moves
 * to the header's `end` slot.
 */
export function BacklogGroup({
  sections,
  dragType,
  canEdit,
  droppable,
  open,
  onOpenChange,
}: BacklogGroupProps) {
  const count = sections.reduce((sum, s) => sum + s.items.length, 0)
  const isEmpty = count === 0
  const { setNodeRef, isOver } = useDroppable({
    id: 'sidebar-backlog',
    data: { type: 'sidebar-backlog' },
    disabled: !droppable,
  })

  return (
    <SidebarGroup>
      <SidebarGroupHeader
        title='Backlog'
        isOpen={open}
        toggleOpen={() => onOpenChange(!open)}
        isEditMode={false}
        onToggleEditMode={() => {}}
        hideEditOption
        end={
          count > 0 ? (
            <span className='text-muted-foreground/70 text-xs tabular-nums'>{count}</span>
          ) : undefined
        }
      />
      <SidebarGroupCollapse open={open}>
        <div
          ref={droppable ? setNodeRef : undefined}
          className={cn(
            'rounded-md',
            droppable && isOver && 'bg-sidebar-accent ring-sidebar-ring ring-1 ring-inset'
          )}>
          <SidebarMenu>
            {isEmpty && (
              <div className='text-muted-foreground px-2 py-1 text-xs'>Nothing waiting.</div>
            )}
            {sections.map((section, index) => {
              if (section.items.length === 0) return null
              return (
                <div key={section.title ?? index}>
                  {section.title && (
                    <div className='text-muted-foreground/70 px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide'>
                      {section.title} ({section.items.length})
                    </div>
                  )}
                  {section.items.map((item) => (
                    <BacklogRow
                      key={item.visit.id}
                      item={item}
                      dragType={dragType}
                      canEdit={canEdit}
                    />
                  ))}
                </div>
              )
            })}
          </SidebarMenu>
        </div>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}

interface BacklogRowProps {
  item: BacklogItem
  dragType: BacklogGroupProps['dragType']
  canEdit: boolean
}

function BacklogRow({ item, dragType, canEdit }: BacklogRowProps) {
  const { visit, workOrder } = item
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-backlog-${visit.id}`,
    data: { type: dragType, visitId: visit.id },
    disabled: !canEdit,
  })
  const status = isVisitStatus(visit.status) ? visit.status : 'scheduled'

  return (
    <SidebarMenuItem>
      <SidebarItem
        ref={setNodeRef}
        {...(canEdit ? { ...attributes, ...listeners } : {})}
        id={`sidebar-backlog-${visit.id}`}
        name={`${workOrder?.number ? `${workOrder.number} · ` : ''}${workOrder?.displayName ?? 'Work order'}`}
        className={cn(
          canEdit && 'cursor-grab touch-none active:cursor-grabbing',
          isDragging && 'opacity-40'
        )}
        icon={
          <span
            className={cn('size-1.5 shrink-0 rounded-full', STATUS_ACCENT_CLASS[status])}
            aria-hidden
          />
        }
        end={
          canEdit ? (
            <GripVertical className='text-muted-foreground size-3 shrink-0 opacity-0 group-hover/item:opacity-100' />
          ) : undefined
        }
      />
    </SidebarMenuItem>
  )
}
