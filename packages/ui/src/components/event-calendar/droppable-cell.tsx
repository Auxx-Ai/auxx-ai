// packages/ui/src/components/event-calendar/droppable-cell.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDroppable } from '@dnd-kit/core'

import { useCalendarDnd } from './calendar-dnd-context'

interface DroppableCellProps {
  id: string
  date: Date
  /** For week/day/resource views — hours (e.g. 9.25 for 9:15). */
  time?: number
  /** Resource column this cell belongs to, in `resources` day mode. */
  resourceId?: string
  children?: React.ReactNode
  className?: string
  onClick?: () => void
}

export function DroppableCell({
  id,
  date,
  time,
  resourceId,
  children,
  className,
  onClick,
}: DroppableCellProps) {
  const { activeEvent } = useCalendarDnd()

  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { date, time, resourceId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        'data-dragging:bg-accent flex h-full flex-col overflow-hidden px-0.5 py-1 sm:px-1',
        className
      )}
      data-dragging={isOver && activeEvent ? true : undefined}>
      {children}
    </div>
  )
}
