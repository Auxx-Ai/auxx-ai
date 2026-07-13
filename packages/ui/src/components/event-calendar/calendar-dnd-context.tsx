// packages/ui/src/components/event-calendar/calendar-dnd-context.tsx

'use client'

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { addMinutes, differenceInMinutes } from 'date-fns'
import { createContext, type ReactNode, useContext, useId, useState } from 'react'

import { EventItem } from './event-item'
import type { CalendarView, EventCalendarItem, RenderEvent } from './types'

type DraggableView = 'month' | 'week' | 'day' | 'resource'

interface CalendarDndContextValue<T extends EventCalendarItem = EventCalendarItem> {
  /** True only when rendered by an actual `CalendarDndProvider` — lets `EventCalendar` detect an ambient/composed provider and skip mounting its own. */
  isCalendarDndContext: boolean
  /** False when the provider has no drop handler at all (read-only grid) — chips render inert
   * instead of offering a pick-up that could only ever snap back. */
  hasDropHandler: boolean
  activeEvent: T | null
  activeId: UniqueIdentifier | null
  activeView: DraggableView | null
  currentTime: Date | null
  /** Resource id of the hovered cell (resource view) — lets the drop outline pick its column. */
  currentResourceId: string | null
  eventHeight: number | null
}

const CalendarDndContext = createContext<CalendarDndContextValue>({
  isCalendarDndContext: false,
  hasDropHandler: false,
  activeEvent: null,
  activeId: null,
  activeView: null,
  currentTime: null,
  currentResourceId: null,
  eventHeight: null,
})

export const useCalendarDnd = () => useContext(CalendarDndContext)

interface CalendarDndProviderProps<T extends EventCalendarItem = EventCalendarItem> {
  children: ReactNode
  /**
   * Fires when a calendar event chip is dropped on one of the calendar's own
   * droppable cells (move = reschedule/reassign). The calendar itself never
   * mutates — this is the only place a write happens, and it's the
   * consumer's job to call their own mutation.
   */
  onEventDrop?: (event: T, newStart: Date, newEnd: Date, resourceId?: string) => void
  /**
   * Escape hatch for composition: fires on every drag end regardless of
   * whether the dragged item is a calendar event. Mount `CalendarDndProvider`
   * yourself (wrapping both `EventCalendar` and e.g. a backlog rail's
   * draggables) and use this to interpret drops of non-calendar items — the
   * provider can't guess a foreign draggable's shape, so it hands you the raw
   * dnd-kit event instead of silently no-oping.
   */
  onDragEnd?: (event: DragEndEvent) => void
  renderEvent?: RenderEvent<T>
}

export function CalendarDndProvider<T extends EventCalendarItem = EventCalendarItem>({
  children,
  onEventDrop,
  onDragEnd,
  renderEvent,
}: CalendarDndProviderProps<T>) {
  const [activeEvent, setActiveEvent] = useState<T | null>(null)
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [activeView, setActiveView] = useState<DraggableView | null>(null)
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [currentResourceId, setCurrentResourceId] = useState<string | null>(null)
  const [eventHeight, setEventHeight] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const dndContextId = useId()

  /** Snaps a fractional-hour drop position (e.g. 9.4) to the nearest 15-minute mark. */
  const snapToQuarterHourMinutes = (time: number) => {
    const fractionalHour = time - Math.floor(time)
    if (fractionalHour < 0.125) return 0
    if (fractionalHour < 0.375) return 15
    if (fractionalHour < 0.625) return 30
    return 45
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const data = active.data.current as
      | { event?: T; view?: DraggableView; height?: number }
      | undefined
    if (!data?.event) return

    setActiveEvent(data.event)
    setActiveId(active.id)
    setActiveView(data.view ?? null)
    setCurrentTime(new Date(data.event.start))
    setEventHeight(data.height ?? null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over || !activeEvent || !over.data.current) return

    const { date, time, resourceId } = over.data.current as {
      date?: Date
      time?: number
      resourceId?: string
    }
    // A foreign droppable (e.g. the module sidebar's Backlog group, `{type: 'sidebar-backlog'}`)
    // has no `date` — nothing to snap the drag-ghost time to. `onDragEnd`'s own `overData.date`
    // check already keeps `onEventDrop` from firing on it; this just stops an `Invalid Date`
    // (`new Date(undefined)`) from being written into `currentTime` while hovering over it.
    if (!date) return

    setCurrentResourceId(resourceId ?? null)

    if (time !== undefined && activeView !== 'month') {
      const newTime = new Date(date)
      const hours = Math.floor(time)
      const minutes = snapToQuarterHourMinutes(time)
      newTime.setHours(hours, minutes, 0, 0)
      setCurrentTime((prev) => (prev?.getTime() === newTime.getTime() ? prev : newTime))
    } else if (activeView === 'month') {
      const newTime = new Date(date)
      if (currentTime) {
        newTime.setHours(
          currentTime.getHours(),
          currentTime.getMinutes(),
          currentTime.getSeconds(),
          0
        )
      }
      setCurrentTime((prev) => (prev?.getTime() === newTime.getTime() ? prev : newTime))
    }
  }

  const resetDragState = () => {
    setActiveEvent(null)
    setActiveId(null)
    setActiveView(null)
    setCurrentTime(null)
    setCurrentResourceId(null)
    setEventHeight(null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && activeEvent && currentTime && active.data.current && over.data.current) {
      const activeData = active.data.current as { event?: T }
      const overData = over.data.current as { date?: Date; time?: number; resourceId?: string }

      if (activeData.event && overData.date) {
        const calendarEvent = activeData.event
        const newStart = new Date(overData.date)

        if (overData.time !== undefined) {
          const hours = Math.floor(overData.time)
          const minutes = snapToQuarterHourMinutes(overData.time)
          newStart.setHours(hours, minutes, 0, 0)
        } else {
          newStart.setHours(
            currentTime.getHours(),
            currentTime.getMinutes(),
            currentTime.getSeconds(),
            0
          )
        }

        const originalStart = new Date(calendarEvent.start)
        const originalEnd = new Date(calendarEvent.end)
        const durationMinutes = differenceInMinutes(originalEnd, originalStart)
        const newEnd = addMinutes(newStart, durationMinutes)

        if (newStart.getTime() !== originalStart.getTime()) {
          onEventDrop?.(calendarEvent, newStart, newEnd, overData.resourceId)
        }
      }
    }

    onDragEnd?.(event)
    resetDragState()
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}>
      <CalendarDndContext.Provider
        value={{
          isCalendarDndContext: true,
          hasDropHandler: Boolean(onEventDrop || onDragEnd),
          activeEvent,
          activeId,
          activeView,
          currentTime,
          currentResourceId,
          eventHeight,
        }}>
        {children}

        {/* The floating copy that follows the pointer — kept translucent (origin stays solid
            in place) and darkened so it reads as "the thing being moved", with the drop
            outline showing through underneath. */}
        <DragOverlay adjustScale={false} dropAnimation={null}>
          {activeEvent && activeView && (
            <div
              className='opacity-80'
              style={{ width: '100%', height: eventHeight ? `${eventHeight}px` : 'auto' }}>
              <EventItem
                event={activeEvent}
                view={activeView as CalendarView}
                isDragging
                showTime={activeView !== 'month'}
                currentTime={currentTime || undefined}
                renderEvent={renderEvent}
              />
            </div>
          )}
        </DragOverlay>
      </CalendarDndContext.Provider>
    </DndContext>
  )
}
