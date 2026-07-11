// packages/ui/src/components/event-calendar/index.ts

export { AgendaView } from './agenda-view'
export { BackgroundEventsLayer } from './background-events'
export { CalendarDndProvider, useCalendarDnd } from './calendar-dnd-context'
// Constants
export {
  AgendaDaysToShow,
  DefaultEndHour,
  DefaultEventColor,
  DefaultStartHour,
  EndHour,
  EventGap,
  EventHeight,
  MinEventDurationMinutes,
  SnapMinutes,
  StartHour,
  WeekCellsHeight,
} from './constants'
export { CurrentTimeGutterLabel, CurrentTimeLine } from './current-time-line'
export { DayView, DayViewHeader } from './day-view'
export { DraggableEvent } from './draggable-event'
export { DroppableCell } from './droppable-cell'
// Shell + views
export { EventCalendar, type EventCalendarProps } from './event-calendar'
// Chip + interaction primitives
export { EventItem } from './event-item'
// Hooks
export {
  type UseCurrentTimeIndicatorResult,
  useCurrentTimeIndicator,
} from './hooks/use-current-time-indicator'
export { type UseEventResizeResult, useEventResize } from './hooks/use-event-resize'
export { HourGutter } from './hour-gutter'
export { MonthView } from './month-view'
// Positioning util (day/week/resource share this — see position-events.ts)
export { type PositionedEvent, positionEventsForDay } from './position-events'
export { ResourceDayView } from './resource-day-view'
// Types
export type {
  BackgroundEvent,
  CalendarResource,
  CalendarView,
  EventCalendarItem,
  RenderEvent,
  RenderEventContext,
} from './types'
// Utils
export {
  eventBorderAccentClass,
  eventColorVar,
  eventSolidBgClass,
  eventTintBgClass,
  eventTintTextClass,
  getAgendaEventsForDay,
  getAllEventsForDay,
  getBorderRadiusClasses,
  getEventsForDay,
  getSpanningEventsForDay,
  isMultiDayEvent,
  sortEvents,
} from './utils'
export { WeekView } from './week-view'
