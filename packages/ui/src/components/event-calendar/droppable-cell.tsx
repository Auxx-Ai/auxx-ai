// packages/ui/src/components/event-calendar/droppable-cell.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'
import { format } from 'date-fns'

import { useCalendarDnd } from './calendar-dnd-context'
import { useCalendarSelection } from './selection/calendar-selection-context'

interface DroppableCellProps {
  id: string
  date: Date
  /** For week/day/resource views — hours (e.g. 9.25 for 9:15). */
  time?: number
  /** Resource column this cell belongs to, in `resources` day mode. */
  resourceId?: string
  /** Drag-create axis (plan 44) — 'y' for the vertical grids (week/day/resource), 'x' for the
   * horizontal timeline. Tells the gesture router which pointer delta to measure the range along. */
  axis?: 'x' | 'y'
  children?: React.ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function DroppableCell({
  id,
  date,
  time,
  resourceId,
  axis = 'y',
  children,
  className,
  onClick,
  onDoubleClick,
}: DroppableCellProps) {
  const { activeEvent } = useCalendarDnd()
  const { reportHoveredSlot } = useCalendarSelection()

  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { date, time, resourceId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerEnter={() => reportHoveredSlot({ date, time, resourceId })}
      className={cn(
        'data-dragging:bg-accent flex h-full flex-col overflow-hidden px-0.5 py-1 sm:px-1',
        className
      )}
      data-dragging={isOver && activeEvent ? true : undefined}
      // Self-describing slot geometry the drag-create router reads (plan 44 §3.3). A cell WITHOUT
      // `data-slot-time` (month day cells) is drag-create-ineligible by construction.
      data-slot-date={format(date, 'yyyy-MM-dd')}
      data-slot-time={time !== undefined ? time : undefined}
      data-slot-resource={resourceId}
      data-slot-axis={time !== undefined ? axis : undefined}>
      {children}
    </div>
  )
}
