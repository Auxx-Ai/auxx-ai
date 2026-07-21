// packages/ui/src/components/event-calendar/draggable-event.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { differenceInDays } from 'date-fns'
import { useRef, useState } from 'react'

import { useCalendarDnd } from './calendar-dnd-context'
import { TimelineHourWidth, WeekCellsHeight } from './constants'
import { EventItem } from './event-item'
import { useEventResize } from './hooks/use-event-resize'
import type { CalendarView, EventCalendarItem, RenderEvent } from './types'

interface DraggableEventProps<T extends EventCalendarItem = EventCalendarItem> {
  event: T
  view: 'month' | 'week' | 'day' | 'resource'
  showTime?: boolean
  onClick?: (e: React.MouseEvent) => void
  height?: number
  /** Chip width (px) — only meaningful with `orientation: 'x'` (the horizontal timeline). */
  width?: number
  isFirstDay?: boolean
  isLastDay?: boolean
  /** Active selection — the event whose detail/popover is open. Draws the in-color ring. */
  isSelected?: boolean
  renderEvent?: RenderEvent<T>
  /** Enables the top/bottom-edge resize handles — only meaningful in week/day/resource. */
  onResize?: (event: T, newStart: Date, newEnd: Date) => void
  /**
   * Resize/handle axis. `'y'` (default) is today's week/day/resource chip: top/bottom handles,
   * height-driven preview. `'x'` is the horizontal timeline's chip: left/right handles,
   * width-driven preview, full-height (`100%`).
   */
  orientation?: 'x' | 'y'
}

export function DraggableEvent<T extends EventCalendarItem = EventCalendarItem>({
  event,
  view,
  showTime,
  onClick,
  height,
  width,
  isFirstDay = true,
  isLastDay = true,
  isSelected,
  renderEvent,
  onResize,
  orientation = 'y',
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
      width: width || elementRef.current?.offsetWidth || null,
      isMultiDay: isMultiDayEvent,
      dragHandlePosition,
      isFirstDay,
      isLastDay,
    },
  })

  const canResize =
    onResize !== undefined && (view === 'week' || view === 'day' || view === 'resource')
  const { isResizing, previewSize, previewOffset, getResizeHandleProps } = useEventResize({
    event,
    axis: orientation,
    cellSize: orientation === 'x' ? TimelineHourWidth : WeekCellsHeight,
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

  const effectiveSize =
    isResizing && previewSize !== null ? previewSize : orientation === 'x' ? width : height

  // 'y' (default): height-driven chip, unchanged from pre-orientation behavior.
  // 'x': full-height chip, width-driven by the resize preview.
  const sizeStyle =
    orientation === 'x'
      ? { height: '100%', width: effectiveSize || 'auto' }
      : { height: effectiveSize || 'auto' }

  const previewTransform =
    isResizing && previewOffset !== 0
      ? orientation === 'x'
        ? `translateX(${previewOffset}px)`
        : `translateY(${previewOffset}px)`
      : undefined

  // During a resize the dnd transform is null (resize stops propagation, so no move-drag),
  // so the start-edge preview translate lives in the else branch alongside the size.
  const style =
    transform && !isDragSource
      ? { transform: CSS.Translate.toString(transform), ...sizeStyle }
      : { ...sizeStyle, transform: previewTransform }

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
      {canResize &&
        (orientation === 'x' ? (
          <>
            {/* Invisible left drag zone — resizes the start time. */}
            <div
              {...getResizeHandleProps('start')}
              className='absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none'
            />
            {/* Invisible right drag zone — resizes the end time. */}
            <div
              {...getResizeHandleProps('end')}
              className='absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none'
            />
          </>
        ) : (
          <>
            {/* Invisible top drag zone — resizes the start time. */}
            <div
              {...getResizeHandleProps('start')}
              className='absolute inset-x-0 top-0 h-2 cursor-ns-resize touch-none'
            />
            {/* Invisible bottom drag zone — resizes the end time. */}
            <div
              {...getResizeHandleProps('end')}
              className='absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none'
            />
          </>
        ))}
    </div>
  )
}
