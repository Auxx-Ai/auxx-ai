// packages/ui/src/components/event-calendar/event-item.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { DraggableAttributes, SyntheticListenerMap } from '@dnd-kit/core'
import { differenceInMinutes, format, getMinutes } from 'date-fns'
import { useMemo } from 'react'
import type { CalendarView, EventCalendarItem, RenderEvent } from './types'
import {
  eventColorVar,
  eventSolidBgClass,
  eventTintBgClass,
  eventTintTextClass,
  getBorderRadiusClasses,
} from './utils'

const formatTimeWithOptionalMinutes = (date: Date) => {
  return format(date, getMinutes(date) === 0 ? 'ha' : 'h:mma').toLowerCase()
}

interface EventWrapperProps {
  event: EventCalendarItem
  isFirstDay?: boolean
  isLastDay?: boolean
  isDragging?: boolean
  onClick?: (e: React.MouseEvent) => void
  className?: string
  children: React.ReactNode
  dndListeners?: SyntheticListenerMap
  dndAttributes?: DraggableAttributes
  onMouseDown?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
}

// Shared interactive wrapper — dnd listeners/attributes, focus ring, drag state.
function EventWrapper({
  event,
  isFirstDay = true,
  isLastDay = true,
  isDragging,
  onClick,
  className,
  children,
  dndListeners,
  dndAttributes,
  onMouseDown,
  onTouchStart,
}: EventWrapperProps) {
  return (
    <button
      type='button'
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 flex h-full w-full overflow-hidden text-left font-medium transition outline-none select-none focus-visible:ring-[3px] data-dragging:cursor-grabbing data-dragging:shadow-lg',
        getBorderRadiusClasses(isFirstDay, isLastDay),
        className
      )}
      style={eventColorVar(event.color)}
      data-dragging={isDragging || undefined}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      {...dndListeners}
      {...dndAttributes}>
      {children}
    </button>
  )
}

interface EventItemProps<T extends EventCalendarItem = EventCalendarItem> {
  event: T
  view: CalendarView
  /** Renders the rounded-full all-day-lane pill styling regardless of `view`. */
  allDayLane?: boolean
  isDragging?: boolean
  onClick?: (e: React.MouseEvent) => void
  showTime?: boolean
  /** Overrides the displayed start/end while dragging (see calendar-dnd-context). */
  currentTime?: Date
  isFirstDay?: boolean
  isLastDay?: boolean
  children?: React.ReactNode
  className?: string
  renderEvent?: RenderEvent<T>
  dndListeners?: SyntheticListenerMap
  dndAttributes?: DraggableAttributes
  onMouseDown?: (e: React.MouseEvent) => void
  onTouchStart?: (e: React.TouchEvent) => void
}

export function EventItem<T extends EventCalendarItem = EventCalendarItem>({
  event,
  view,
  allDayLane,
  isDragging,
  onClick,
  showTime,
  currentTime,
  isFirstDay = true,
  isLastDay = true,
  children,
  className,
  renderEvent,
  dndListeners,
  dndAttributes,
  onMouseDown,
  onTouchStart,
}: EventItemProps<T>) {
  const displayStart = useMemo(
    () => currentTime || new Date(event.start),
    [currentTime, event.start]
  )

  const displayEnd = useMemo(() => {
    return currentTime
      ? new Date(
          new Date(currentTime).getTime() +
            (new Date(event.end).getTime() - new Date(event.start).getTime())
        )
      : new Date(event.end)
  }, [currentTime, event.start, event.end])

  const durationMinutes = useMemo(
    () => differenceInMinutes(displayEnd, displayStart),
    [displayStart, displayEnd]
  )

  const getEventTime = () => {
    if (event.allDay) return 'All day'
    if (durationMinutes < 45) return formatTimeWithOptionalMinutes(displayStart)
    return `${formatTimeWithOptionalMinutes(displayStart)} - ${formatTimeWithOptionalMinutes(displayEnd)}`
  }

  // `renderEvent`, when provided, always wins — even a `null` return means "render nothing",
  // which nullish-coalescing against `children` would otherwise silently override.
  const renderedContent = renderEvent?.(event, {
    view,
    isFirstDay,
    isLastDay,
    isDragging: Boolean(isDragging),
  })
  const resolveContent = (defaultNode: React.ReactNode): React.ReactNode =>
    renderEvent ? renderedContent : (children ?? defaultNode)

  // All-day lane: rounded-full pill, leading color-circle badge, trailing indicator slot.
  if (allDayLane) {
    return (
      <EventWrapper
        event={event}
        isFirstDay={isFirstDay}
        isLastDay={isLastDay}
        isDragging={isDragging}
        onClick={onClick}
        className={cn(
          'items-center gap-1.5 rounded-full px-2 py-1 text-[10px] sm:text-xs',
          eventTintBgClass,
          className
        )}
        dndListeners={dndListeners}
        dndAttributes={dndAttributes}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}>
        {resolveContent(
          <>
            <span
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-full',
                eventSolidBgClass
              )}>
              <span className='size-1.5 rounded-full bg-black/40' />
            </span>
            <span className={cn('truncate font-semibold', eventTintTextClass)}>{event.title}</span>
            {event.badge && <span className='ml-auto shrink-0 opacity-70'>{event.badge}</span>}
          </>
        )}
      </EventWrapper>
    )
  }

  // Month chips are filled tinted bars (Notion-style): the event color fills the chip and
  // carries into the text, title left / time right. `--ec-color` is set on the wrapper for
  // every view, so the same tint tokens as week/day apply here.
  if (view === 'month') {
    return (
      <EventWrapper
        event={event}
        isFirstDay={isFirstDay}
        isLastDay={isLastDay}
        isDragging={isDragging}
        onClick={onClick}
        className={cn(
          'mt-[var(--event-gap)] h-[var(--event-height)] items-center gap-1.5 rounded-md px-1 text-[10px] sm:px-1.5 sm:text-xs',
          eventTintBgClass,
          eventTintTextClass,
          'hover:brightness-105 dark:hover:brightness-110',
          className
        )}
        dndListeners={dndListeners}
        dndAttributes={dndAttributes}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}>
        {resolveContent(
          <>
            <span className={cn('h-full w-1 shrink-0 rounded-full', eventSolidBgClass)} />
            <span className='min-w-0 flex-1 truncate font-semibold'>{event.title}</span>
            {!event.allDay && (
              <span className='shrink-0 font-normal opacity-70'>
                {formatTimeWithOptionalMinutes(displayStart)}
              </span>
            )}
          </>
        )}
      </EventWrapper>
    )
  }

  if (view === 'week' || view === 'day' || view === 'resource') {
    return (
      <EventWrapper
        event={event}
        isFirstDay={isFirstDay}
        isLastDay={isLastDay}
        isDragging={isDragging}
        onClick={onClick}
        className={cn(
          'px-1.5 py-1 sm:px-2',
          durationMinutes < 45 ? 'items-center' : 'flex-col',
          view === 'resource' || view === 'week' ? 'text-[10px] sm:text-xs' : 'text-xs',
          eventTintBgClass,
          className
        )}
        dndListeners={dndListeners}
        dndAttributes={dndAttributes}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}>
        {resolveContent(
          durationMinutes < 45 ? (
            <div className={cn('truncate font-semibold', eventTintTextClass)}>
              {event.title}{' '}
              {showTime && (
                <span className='font-normal opacity-70'>
                  {formatTimeWithOptionalMinutes(displayStart)}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className={cn('truncate font-semibold', eventTintTextClass)}>{event.title}</div>
              {showTime && (
                <div
                  className={cn('truncate text-[11px] font-normal opacity-70', eventTintTextClass)}>
                  {getEventTime()}
                </div>
              )}
            </>
          )
        )}
      </EventWrapper>
    )
  }

  // Agenda view — a full-width card, kept separate since it shows description/location too.
  return (
    <button
      type='button'
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 flex w-full flex-col gap-1 rounded-xl p-2 text-left transition outline-none focus-visible:ring-[3px]',
        eventTintBgClass,
        className
      )}
      style={eventColorVar(event.color)}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      {...dndListeners}
      {...dndAttributes}>
      {resolveContent(
        <>
          <div className={cn('text-sm font-semibold', eventTintTextClass)}>{event.title}</div>
          <div className='text-muted-foreground text-xs'>
            {event.allDay ? (
              <span>All day</span>
            ) : (
              <span className='uppercase'>
                {formatTimeWithOptionalMinutes(displayStart)} -{' '}
                {formatTimeWithOptionalMinutes(displayEnd)}
              </span>
            )}
            {event.location && (
              <>
                <span className='px-1 opacity-35'> · </span>
                <span>{event.location}</span>
              </>
            )}
          </div>
          {event.description && (
            <div className='text-muted-foreground my-1 text-xs'>{event.description}</div>
          )}
        </>
      )}
    </button>
  )
}
