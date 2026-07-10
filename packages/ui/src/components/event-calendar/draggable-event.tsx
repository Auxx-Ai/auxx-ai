// packages/ui/src/components/event-calendar/draggable-event.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { differenceInDays } from 'date-fns'
import { useRef, useState } from 'react'

import { useCalendarDnd } from './calendar-dnd-context'
import { WeekCellsHeight } from './constants'
import { EventItem } from './event-item'
import { useEventResize } from './hooks/use-event-resize'
import type { CalendarView, EventCalendarItem, RenderEvent } from './types'

interface DraggableEventProps<T extends EventCalendarItem = EventCalendarItem> {
  event: T
  view: 'month' | 'week' | 'day' | 'resource'
  showTime?: boolean
  onClick?: (e: React.MouseEvent) => void
  height?: number
  isFirstDay?: boolean
  isLastDay?: boolean
  renderEvent?: RenderEvent<T>
  /** Enables the bottom-edge resize handle — only meaningful in week/day/resource. */
  onResize?: (event: T, newEnd: Date) => void
}

export function DraggableEvent<T extends EventCalendarItem = EventCalendarItem>({
  event,
  view,
  showTime,
  onClick,
  height,
  isFirstDay = true,
  isLastDay = true,
  renderEvent,
  onResize,
}: DraggableEventProps<T>) {
  const { activeId } = useCalendarDnd()
  const elementRef = useRef<HTMLDivElement>(null)
  const [dragHandlePosition, setDragHandlePosition] = useState<{ x: number; y: number } | null>(
    null
  )

  const eventStart = new Date(event.start)
  const eventEnd = new Date(event.end)
  const isMultiDayEvent = event.allDay || differenceInDays(eventEnd, eventStart) >= 1

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${event.id}-${view}`,
    data: {
      event,
      view,
      height: height || elementRef.current?.offsetHeight || null,
      isMultiDay: isMultiDayEvent,
      dragHandlePosition,
      isFirstDay,
      isLastDay,
    },
  })

  const canResize =
    onResize !== undefined && (view === 'week' || view === 'day' || view === 'resource')
  const { isResizing, previewHeight, resizeHandleProps } = useEventResize({
    event,
    cellHeight: WeekCellsHeight,
    onResize,
  })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (elementRef.current) {
      const rect = elementRef.current.getBoundingClientRect()
      setDragHandlePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (elementRef.current) {
      const rect = elementRef.current.getBoundingClientRect()
      const touch = e.touches[0]
      if (touch) {
        setDragHandlePosition({ x: touch.clientX - rect.left, y: touch.clientY - rect.top })
      }
    }
  }

  // Don't render if this event is being dragged (the DragOverlay ghost stands in for it).
  if (isDragging || activeId === `${event.id}-${view}`) {
    return <div ref={setNodeRef} className='opacity-0' style={{ height: height || 'auto' }} />
  }

  const effectiveHeight = isResizing && previewHeight !== null ? previewHeight : height

  const style = transform
    ? { transform: CSS.Translate.toString(transform), height: effectiveHeight || 'auto' }
    : { height: effectiveHeight || 'auto' }

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        elementRef.current = node
      }}
      style={style}
      className={cn('group/event touch-none', canResize && 'relative')}>
      <EventItem
        event={event}
        view={view as CalendarView}
        showTime={showTime}
        isFirstDay={isFirstDay}
        isLastDay={isLastDay}
        isDragging={isDragging}
        onClick={onClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        dndListeners={listeners}
        dndAttributes={attributes}
        renderEvent={renderEvent}
      />
      {canResize && (
        <div
          {...resizeHandleProps}
          className={cn(
            'absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize touch-none items-end justify-center opacity-0 transition-opacity group-hover/event:opacity-100',
            isResizing && 'opacity-100'
          )}>
          <span className='mb-0.5 h-1 w-6 rounded-full bg-current opacity-40' />
        </div>
      )}
    </div>
  )
}
