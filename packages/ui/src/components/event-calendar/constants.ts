// packages/ui/src/components/event-calendar/constants.ts

/**
 * The month/week continuous streams span these years — index 0 is the first
 * day (week view) or first week (month view) of the start year.
 */
export const StreamStartYear = 2020
export const StreamEndYear = 2045

/** Height (px) of a month-view event chip — drives the "+N more" overflow math. */
export const EventHeight = 24

/** Vertical gap (px) between stacked month-view event chips. */
export const EventGap = 4

/** Height (px) of one hour row in week/day/resource views. */
export const WeekCellsHeight = 72

/** Number of days shown in agenda view. */
export const AgendaDaysToShow = 30

/** First/last hour rendered in week/day/resource grids. */
export const StartHour = 0
export const EndHour = 24

/** Default duration (hours) used when a slot click doesn't specify one. */
export const DefaultStartHour = 9
export const DefaultEndHour = 10

/** Fallback event accent color (indigo-500) when `event.color` is unset. */
export const DefaultEventColor = '#6366f1'

/** Minimum event duration (minutes) enforced by drag-resize. */
export const MinEventDurationMinutes = 15

/** Snap increment (minutes) for both drag-move and drag-resize. */
export const SnapMinutes = 15

/** Current-time indicator accent — a fixed brand accent, not tied to any event color. */
export const CurrentTimeLineClass = 'bg-rose-600 dark:bg-rose-500'
export const CurrentTimeLabelClass = 'bg-rose-600 text-white dark:bg-rose-500'
