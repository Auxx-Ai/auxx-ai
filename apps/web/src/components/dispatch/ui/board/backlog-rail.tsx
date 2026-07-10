// apps/web/src/components/dispatch/ui/board/backlog-rail.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import type { BoardVisit, BoardWorkOrder } from './types'

export interface BacklogItem {
  visit: BoardVisit
  workOrder: BoardWorkOrder | undefined
}

interface BacklogRailProps {
  items: BacklogItem[]
  canEdit: boolean
}

/**
 * Collapsible unscheduled-visits rail (07 §D.2): `startTime: null` visits, dnd-kit
 * draggables sharing the board's ambient `CalendarDndProvider` so a drop lands on the
 * calendar's own droppable cells. The provider's `onDragEnd` escape hatch (mounted by
 * `dispatch-board.tsx`) interprets these drags — the calendar itself can't, since a rail
 * item isn't a calendar event.
 */
export function BacklogRail({ items, canEdit }: BacklogRailProps) {
  return (
    <div className='flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-2'>
      <div className='text-muted-foreground px-1 pb-1 text-xs font-medium'>
        Unscheduled ({items.length})
      </div>
      {items.length === 0 && (
        <div className='text-muted-foreground px-1 text-xs'>Nothing waiting to be scheduled.</div>
      )}
      {items.map((item) => (
        <BacklogVisitCard key={item.visit.id} item={item} canEdit={canEdit} />
      ))}
    </div>
  )
}

function BacklogVisitCard({ item, canEdit }: { item: BacklogItem; canEdit: boolean }) {
  const { visit, workOrder } = item
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `backlog-${visit.id}`,
    data: { type: 'backlog-visit', visitId: visit.id },
    disabled: !canEdit,
  })

  return (
    <div
      ref={setNodeRef}
      {...(canEdit ? { ...attributes, ...listeners } : {})}
      className={cn(
        'bg-card rounded-md border p-2 text-xs',
        canEdit && 'cursor-grab touch-none active:cursor-grabbing',
        isDragging && 'opacity-40'
      )}>
      <div className='truncate font-medium'>
        {workOrder?.number ? `${workOrder.number} · ` : ''}
        {workOrder?.displayName ?? 'Work order'}
      </div>
      {workOrder?.contactDisplayName && (
        <div className='text-muted-foreground truncate'>{workOrder.contactDisplayName}</div>
      )}
    </div>
  )
}
