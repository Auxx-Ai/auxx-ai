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
  /** Active selection — the event whose detail/popover is open. Draws the in-color ring. */
  isSelected?: boolean
  renderEvent?: RenderEvent<T>
  /** Enables the top/bottom-edge resize handles — only meaningful in week/day/resource. */
  onResize?: (event: T, newStart: Date, newEnd: Date) => void
}

export function DraggableEvent<T extends EventCalendarItem = EventCalendarItem>({
  event,
  view,
  showTime,
  onClick,
  height,
  isFirstDay = true,
  isLastDay = true,
  isSelected,
  renderEvent,
  onResize,
}: DraggableEventProps<T>) {
  const { activeId, hasDropHandler } = useCalendarDnd()
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
  const { isResizing, previewHeight, previewOffsetY, getResizeHandleProps } = useEventResize({
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

  // While this event is the drag source, the origin stays put and solid — the translucent
  // DragOverlay copy is the "moving" one — so we neither hide the origin nor apply the
  // pointer `transform` to it (that would make the origin chase the cursor as a second ghost).
  const isDragSource = isDragging || activeId === `${event.id}-${view}`

  const effectiveHeight = isResizing && previewHeight !== null ? previewHeight : height

  // During a resize the dnd transform is null (resize stops propagation, so no move-drag),
  // so the top-edge preview translate lives in the else branch alongside the height.
  const style =
    transform && !isDragSource
      ? { transform: CSS.Translate.toString(transform), height: effectiveHeight || 'auto' }
      : {
          height: effectiveHeight || 'auto',
          transform:
            isResizing && previewOffsetY !== 0 ? `translateY(${previewOffsetY}px)` : undefined,
        }

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
        isSelected={isSelected}
        onClick={onClick}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        // No drop handler anywhere (read-only grid) → don't offer a pick-up that could only
        // ever snap back; click stays wired.
        dndListeners={hasDropHandler ? listeners : undefined}
        dndAttributes={hasDropHandler ? attributes : undefined}
        renderEvent={renderEvent}
      />
      {canResize && (
        <>
          {/* Invisible top drag zone — resizes the start time. */}
          <div
            {...getResizeHandleProps('top')}
            className='absolute inset-x-0 top-0 h-2 cursor-ns-resize touch-none'
          />
          {/* Invisible bottom drag zone — resizes the end time. */}
          <div
            {...getResizeHandleProps('bottom')}
            className='absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none'
          />
        </>
      )}
    </div>
  )
}
